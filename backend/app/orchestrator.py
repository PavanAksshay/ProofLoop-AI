from dataclasses import dataclass
from uuid import uuid4

from .agent import propose_next_action
from .models import (
    Actor,
    ApprovalDecisionRequest,
    Event,
    IncidentResponse,
    IncidentRunRequest,
    Outcome,
    PolicyDecision,
    ToolRequest,
)
from .policy import evaluate_action
from .simulator import ServiceSimulator
from .verifier import verify_recovery
from .store import append_event, create_incident, incident_exists


MAX_ACTION_ATTEMPTS = 3


@dataclass
class PendingApproval:
    incident_id: str
    scenario: str
    client: str
    simulator: ServiceSimulator
    events: list[Event]
    action: ToolRequest
    attempt: int
    rule_id: str
    reason: str


# Prototype-only process memory. Restarting the server clears pending approvals.
_pending_approvals: dict[str, PendingApproval] = {}
_completed_incidents: dict[str, IncidentResponse] = {}


def _response(
    incident_id: str,
    scenario: str,
    client: str,
    outcome: Outcome,
    summary: str,
    events: list[Event],
) -> IncidentResponse:
    return IncidentResponse(
        incident_id=incident_id,
        scenario=scenario,
        client=client,
        outcome=outcome,
        summary=summary,
        mode="fallback",
        events=events,
    )


def _emit(events: list[Event], incident_id: str, event_type: str, actor: Actor, payload: dict, refs: list[str] | None = None) -> None:
    event = Event(
        incident_id=incident_id,
        type=event_type,
        actor=actor,
        payload=payload,
        evidence_refs=refs or [],
    )
    events.append(event)
    append_event(event)


def _verify_and_report(incident_id: str, scenario: str, client: str, simulator: ServiceSimulator, events: list[Event]) -> IncidentResponse:
    report = verify_recovery(simulator)
    for check in report.checks:
        _emit(events, incident_id, "verification_check", Actor.VERIFIER, check.model_dump(mode="json"))
    _emit(events, incident_id, "verification_result", Actor.VERIFIER, report.model_dump(mode="json"))
    if report.all_passed:
        outcome = Outcome.VERIFIED
        summary = "All three independent recovery checks passed."
    else:
        outcome = Outcome.ESCALATED
        summary = "Recovery could not be proven; the incident was escalated."
    _emit(events, incident_id, "outcome", Actor.SYSTEM, {"outcome": outcome.value, "summary": summary})
    response = _response(incident_id, scenario, client, outcome, summary, events)
    _completed_incidents[incident_id] = response
    return response


def run_incident(request: IncidentRunRequest, incident_id: str | None = None) -> IncidentResponse:
    incident_id = incident_id or str(uuid4())
    events: list[Event] = []

    try:
        simulator = ServiceSimulator(request.scenario)
    except ValueError as exc:
        raise ValueError(str(exc)) from exc

    if not incident_exists(incident_id):
        create_incident(incident_id, request.scenario, request.client, Outcome.RUNNING, "Incident started.")

    _emit(events, incident_id, "incident_opened", Actor.SYSTEM, {
        "scenario": request.scenario,
        "client": request.client,
        "mode": request.mode,
    })
    logs = simulator.read_logs("checkout-service").result.get("logs", [])
    _emit(events, incident_id, "evidence_collected", Actor.TOOL, {"source": "logs", "excerpt": logs}, ["logs:checkout-service"])

    if any("ignore policy" in line.lower() or "delete the database" in line.lower() for line in logs):
        _emit(events, incident_id, "injection_detected", Actor.SYSTEM, {
            "message": "Instruction-like text detected in untrusted log data; treated as data."
        }, ["logs:checkout-service"])

    outcome = Outcome.ESCALATED
    summary = "Incident reached a safe stop without a verified recovery."

    for attempt in range(MAX_ACTION_ATTEMPTS):
        action, rationale, evidence_refs = propose_next_action(simulator)
        _emit(events, incident_id, "action_proposed", Actor.AGENT, {
            "attempt": attempt + 1,
            "tool": action.tool,
            "service": action.service,
            "arguments": action.arguments,
            "rationale": rationale,
        }, evidence_refs)

        decision = evaluate_action(action, request.client)
        _emit(events, incident_id, "policy_decision", Actor.GATE, decision.model_dump(mode="json"), evidence_refs)

        if decision.decision == PolicyDecision.BLOCKED:
            outcome = Outcome.BLOCKED
            summary = f"Action blocked by policy: {decision.reason}"
            break

        if decision.decision == PolicyDecision.APPROVAL_REQUIRED:
            # No simulator call occurs before the human decision.
            before = simulator.snapshot()
            _emit(events, incident_id, "approval_requested", Actor.SYSTEM, {
                "tool": action.tool,
                "service": action.service,
                "arguments": action.arguments,
                "rule_id": decision.rule_id,
                "reason": decision.reason,
                "attempt": attempt + 1,
            }, evidence_refs)
            if simulator.snapshot() != before:
                raise RuntimeError("Simulator mutated while approval was pending")
            pending = PendingApproval(
                incident_id=incident_id,
                scenario=request.scenario,
                client=request.client,
                simulator=simulator,
                events=events,
                action=action,
                attempt=attempt + 1,
                rule_id=decision.rule_id,
                reason=decision.reason,
            )
            _pending_approvals[incident_id] = pending
            response = _response(
                incident_id, request.scenario, request.client,
                Outcome.PENDING_APPROVAL,
                "Waiting for an explicit human approval decision. No action has been executed.",
                events,
            )
            return response

        if action.tool == "escalate_to_human":
            outcome = Outcome.ESCALATED
            summary = str(action.arguments.get("summary", "Escalated to a human operator."))
            break

        result = simulator.execute(action)
        _emit(events, incident_id, "tool_executed", Actor.TOOL, {
            "tool": action.tool,
            "arguments": action.arguments,
            "success": result.success,
            "message": result.message,
            "result": result.result,
            "error": result.error,
        })
        if not result.success:
            continue

        report = verify_recovery(simulator)
        for check in report.checks:
            _emit(events, incident_id, "verification_check", Actor.VERIFIER, check.model_dump(mode="json"))
        _emit(events, incident_id, "verification_result", Actor.VERIFIER, report.model_dump(mode="json"))
        if report.all_passed:
            outcome = Outcome.VERIFIED
            summary = "All three independent recovery checks passed."
            break

    _emit(events, incident_id, "outcome", Actor.SYSTEM, {"outcome": outcome.value, "summary": summary})
    response = _response(incident_id, request.scenario, request.client, outcome, summary, events)
    _completed_incidents[incident_id] = response
    return response


def decide_approval(incident_id: str, request: ApprovalDecisionRequest) -> IncidentResponse:
    pending = _pending_approvals.get(incident_id)
    if pending is None:
        if incident_id in _completed_incidents:
            raise ValueError("This incident has already reached a final outcome; approval cannot be changed.")
        raise KeyError("No pending approval exists for this incident.")

    # Re-evaluate the policy against the exact stored action. A client approval
    # cannot change the tool, service, or arguments that were originally proposed.
    current_policy = evaluate_action(pending.action, pending.client)
    if current_policy.decision == PolicyDecision.BLOCKED:
        del _pending_approvals[incident_id]
        raise PermissionError(f"Action is now blocked by policy: {current_policy.reason}")

    _emit(pending.events, incident_id, "human_approval_decision", Actor.HUMAN, {
        "approver_id": request.approver_id,
        "decision": request.decision,
        "comment": request.comment,
        "rule_id": pending.rule_id,
    })

    if request.decision == "deny":
        del _pending_approvals[incident_id]
        summary = "The proposed action was denied by a human; no action was executed."
        _emit(pending.events, incident_id, "outcome", Actor.SYSTEM, {"outcome": Outcome.BLOCKED.value, "summary": summary})
        response = _response(incident_id, pending.scenario, pending.client, Outcome.BLOCKED, summary, pending.events)
        _completed_incidents[incident_id] = response
        return response

    result = pending.simulator.execute(pending.action)
    _emit(pending.events, incident_id, "tool_executed", Actor.TOOL, {
        "tool": pending.action.tool,
        "arguments": pending.action.arguments,
        "success": result.success,
        "message": result.message,
        "result": result.result,
        "error": result.error,
        "approved_by": request.approver_id,
    })
    del _pending_approvals[incident_id]

    if not result.success:
        summary = "The approved action failed to execute; the incident was escalated."
        _emit(pending.events, incident_id, "outcome", Actor.SYSTEM, {"outcome": Outcome.ESCALATED.value, "summary": summary})
        response = _response(incident_id, pending.scenario, pending.client, Outcome.ESCALATED, summary, pending.events)
        _completed_incidents[incident_id] = response
        return response

    return _verify_and_report(
        incident_id, pending.scenario, pending.client, pending.simulator, pending.events
    )


def get_incident(incident_id: str) -> IncidentResponse | None:
    pending = _pending_approvals.get(incident_id)
    if pending is not None:
        return _response(
            incident_id, pending.scenario, pending.client,
            Outcome.PENDING_APPROVAL,
            "Waiting for an explicit human approval decision. No action has been executed.",
            pending.events,
        )
    return _completed_incidents.get(incident_id)
