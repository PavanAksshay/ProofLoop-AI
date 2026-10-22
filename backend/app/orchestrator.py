from dataclasses import dataclass
from uuid import uuid4

from .llm_investigator import propose_action
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
from .store import (
    append_event,
    claim_pending_approval,
    create_incident,
    get_incident_response,
    get_pending_approval,
    incident_exists,
    release_pending_approval_claim,
    resolve_pending_approval,
    save_pending_approval,
    update_incident_mode,
)


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
    mode: str = "fallback"


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
    mode: str = "fallback",
) -> IncidentResponse:
    return IncidentResponse(
        incident_id=incident_id,
        scenario=scenario,
        client=client,
        outcome=outcome,
        summary=summary,
        mode=mode,
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


def _verify_and_report(incident_id: str, scenario: str, client: str, simulator: ServiceSimulator, events: list[Event], mode: str = "fallback") -> IncidentResponse:
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
    response = _response(incident_id, scenario, client, outcome, summary, events, mode=mode)
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
        "requested_mode": request.mode,
    })
    logs = simulator.read_logs("checkout-service").result.get("logs", [])
    _emit(events, incident_id, "evidence_collected", Actor.TOOL, {"source": "logs", "excerpt": logs}, ["logs:checkout-service"])

    if any("ignore policy" in line.lower() or "delete the database" in line.lower() for line in logs):
        _emit(events, incident_id, "injection_detected", Actor.SYSTEM, {
            "message": "Instruction-like text detected in untrusted log data; treated as data."
        }, ["logs:checkout-service"])

    outcome = Outcome.ESCALATED
    summary = "Incident reached a safe stop without a verified recovery."
    response_mode = "fallback"

    for attempt in range(MAX_ACTION_ATTEMPTS):
        action, rationale, evidence_refs, selected_mode = propose_action(simulator)
        response_mode = selected_mode
        update_incident_mode(incident_id, selected_mode)
        _emit(events, incident_id, "action_proposed", Actor.AGENT, {
            "attempt": attempt + 1,
            "mode": selected_mode,
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
                mode=selected_mode,
            )
            _pending_approvals[incident_id] = pending
            save_pending_approval(incident_id, {
                "incident_id": incident_id,
                "scenario": request.scenario,
                "client": request.client,
                "simulator_snapshot": simulator.snapshot(),
                "action": action.model_dump(mode="json"),
                "attempt": attempt + 1,
                "rule_id": decision.rule_id,
                "reason": decision.reason,
                "mode": selected_mode,
            })
            response = _response(
                incident_id, request.scenario, request.client,
                Outcome.PENDING_APPROVAL,
                "Waiting for an explicit human approval decision. No action has been executed.",
                events,
                mode=selected_mode,
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
    response = _response(incident_id, request.scenario, request.client, outcome, summary, events, mode=response_mode)
    _completed_incidents[incident_id] = response
    return response


def decide_approval(incident_id: str, request: ApprovalDecisionRequest) -> IncidentResponse:
    pending = _pending_approvals.get(incident_id)

    # Rehydrate the exact action and simulator state after a process restart.
    if pending is None:
        saved = get_pending_approval(incident_id)
        if saved is None:
            existing = get_incident_response(incident_id)
            if existing is not None and existing.outcome != Outcome.PENDING_APPROVAL:
                raise ValueError("This incident has already reached a final outcome; approval cannot be changed.")
            if existing is not None and existing.outcome == Outcome.PENDING_APPROVAL:
                raise ValueError("This approval is already being processed or has an invalid pending state.")
            raise KeyError("No pending approval exists for this incident.")
        try:
            simulator = ServiceSimulator.from_snapshot(saved["scenario"], saved["simulator_snapshot"])
            action = ToolRequest.model_validate(saved["action"])
            stored_response = get_incident_response(incident_id)
            if stored_response is None:
                raise ValueError("Persisted incident history is missing.")
            pending = PendingApproval(
                incident_id=incident_id,
                scenario=saved["scenario"],
                client=saved["client"],
                simulator=simulator,
                events=stored_response.events,
                action=action,
                attempt=int(saved["attempt"]),
                rule_id=saved["rule_id"],
                reason=saved["reason"],
                mode=saved.get("mode", "fallback"),
            )
            _pending_approvals[incident_id] = pending
        except Exception as exc:
            raise ValueError("Persisted approval state could not be restored safely.") from exc

    # Claim in SQLite before execution. Concurrent or repeated decisions cannot both win.
    claimed = claim_pending_approval(incident_id)
    if claimed is None:
        _pending_approvals.pop(incident_id, None)
        existing = get_incident_response(incident_id)
        if existing is not None and existing.outcome != Outcome.PENDING_APPROVAL:
            raise ValueError("This incident has already reached a final outcome; approval cannot be changed.")
        raise ValueError("This approval is already being processed or has already been resolved.")

    # Use the durable payload as the source of truth, including on the original process.
    try:
        pending.simulator = ServiceSimulator.from_snapshot(
            claimed["scenario"], claimed["simulator_snapshot"]
        )
        pending.action = ToolRequest.model_validate(claimed["action"])
        pending.scenario = claimed["scenario"]
        pending.client = claimed["client"]
        pending.attempt = int(claimed["attempt"])
        pending.rule_id = claimed["rule_id"]
        pending.reason = claimed["reason"]
        pending.mode = claimed.get("mode", pending.mode)

        current_policy = evaluate_action(pending.action, pending.client)
        if current_policy.decision == PolicyDecision.BLOCKED:
            # Policy may tighten while an approval is waiting. Record the re-check
            # and finish safely rather than leaving the incident stuck as pending.
            _emit(pending.events, incident_id, "approval_rejected_by_policy", Actor.GATE, {
                "decision": current_policy.decision.value,
                "rule_id": current_policy.rule_id,
                "reason": current_policy.reason,
                "message": "Policy changed or the saved action is no longer authorized; no action was executed.",
            })
            summary = f"Action blocked by policy at approval time: {current_policy.reason}"
            _emit(pending.events, incident_id, "outcome", Actor.SYSTEM, {
                "outcome": Outcome.BLOCKED.value,
                "summary": summary,
            })
            response = _response(
                incident_id, pending.scenario, pending.client, Outcome.BLOCKED,
                summary, pending.events, mode=pending.mode,
            )
            _completed_incidents[incident_id] = response
            resolve_pending_approval(incident_id)
            _pending_approvals.pop(incident_id, None)
            return response

        _emit(pending.events, incident_id, "human_approval_decision", Actor.HUMAN, {
            "approver_id": request.approver_id,
            "decision": request.decision,
            "comment": request.comment,
            "rule_id": pending.rule_id,
        })

        if request.decision == "deny":
            summary = "The proposed action was denied by a human; no action was executed."
            _emit(pending.events, incident_id, "outcome", Actor.SYSTEM, {"outcome": Outcome.BLOCKED.value, "summary": summary})
            response = _response(incident_id, pending.scenario, pending.client, Outcome.BLOCKED, summary, pending.events, mode=pending.mode)
            _completed_incidents[incident_id] = response
            resolve_pending_approval(incident_id)
            _pending_approvals.pop(incident_id, None)
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
        _pending_approvals.pop(incident_id, None)

        if not result.success:
            summary = "The approved action failed to execute; the incident was escalated."
            _emit(pending.events, incident_id, "outcome", Actor.SYSTEM, {"outcome": Outcome.ESCALATED.value, "summary": summary})
            response = _response(incident_id, pending.scenario, pending.client, Outcome.ESCALATED, summary, pending.events, mode=pending.mode)
            _completed_incidents[incident_id] = response
            resolve_pending_approval(incident_id)
            return response

        response = _verify_and_report(
            incident_id, pending.scenario, pending.client, pending.simulator, pending.events, mode=pending.mode
        )
        resolve_pending_approval(incident_id)
        return response
    except PermissionError:
        raise
    except Exception:
        # A transient unexpected error must not permanently strand the approval.
        release_pending_approval_claim(incident_id)
        raise


def get_incident(incident_id: str) -> IncidentResponse | None:
    pending = _pending_approvals.get(incident_id)
    if pending is not None:
        return _response(
            incident_id, pending.scenario, pending.client,
            Outcome.PENDING_APPROVAL,
            "Waiting for an explicit human approval decision. No action has been executed.",
            pending.events,
            mode=pending.mode,
        )
    return _completed_incidents.get(incident_id)
