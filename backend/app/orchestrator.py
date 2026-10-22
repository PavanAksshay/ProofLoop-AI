from uuid import uuid4

from .agent import propose_next_action
from .models import Actor, Event, IncidentResponse, Outcome, PolicyDecision, IncidentRunRequest
from .policy import evaluate_action
from .simulator import ServiceSimulator
from .verifier import verify_recovery


MAX_ACTION_ATTEMPTS = 3


def run_incident(request: IncidentRunRequest) -> IncidentResponse:
    incident_id = str(uuid4())
    events: list[Event] = []

    def emit(event_type: str, actor: Actor, payload: dict, refs: list[str] | None = None) -> None:
        events.append(Event(incident_id=incident_id, type=event_type, actor=actor, payload=payload, evidence_refs=refs or []))

    try:
        simulator = ServiceSimulator(request.scenario)
    except ValueError as exc:
        raise ValueError(str(exc)) from exc

    emit("incident_opened", Actor.SYSTEM, {"scenario": request.scenario, "client": request.client, "mode": request.mode})
    logs = simulator.read_logs("checkout-service").result.get("logs", [])
    emit("evidence_collected", Actor.TOOL, {"source": "logs", "excerpt": logs}, ["logs:checkout-service"])

    if any("ignore policy" in line.lower() or "delete the database" in line.lower() for line in logs):
        emit("injection_detected", Actor.SYSTEM, {"message": "Instruction-like text detected in untrusted log data; treated as data."}, ["logs:checkout-service"])

    outcome = Outcome.ESCALATED
    summary = "Incident reached a safe stop without a verified recovery."

    for attempt in range(MAX_ACTION_ATTEMPTS):
        action, rationale, evidence_refs = propose_next_action(simulator)
        emit("action_proposed", Actor.AGENT, {"attempt": attempt + 1, "tool": action.tool, "service": action.service, "arguments": action.arguments, "rationale": rationale}, evidence_refs)

        decision = evaluate_action(action, request.client)
        emit("policy_decision", Actor.GATE, decision.model_dump(mode="json"), evidence_refs)

        if decision.decision == PolicyDecision.BLOCKED:
            outcome = Outcome.BLOCKED
            summary = f"Action blocked by policy: {decision.reason}"
            break

        if decision.decision == PolicyDecision.APPROVAL_REQUIRED:
            emit("approval_requested", Actor.SYSTEM, {"tool": action.tool, "arguments": action.arguments, "rule_id": decision.rule_id, "reason": decision.reason})
            outcome = Outcome.ESCALATED
            summary = "Human approval is required; no action was executed in this synchronous demo endpoint."
            break

        if action.tool == "escalate_to_human":
            outcome = Outcome.ESCALATED
            summary = str(action.arguments.get("summary", "Escalated to a human operator."))
            break

        result = simulator.execute(action)
        emit("tool_executed", Actor.TOOL, {"tool": action.tool, "arguments": action.arguments, "success": result.success, "message": result.message, "result": result.result, "error": result.error})
        if not result.success:
            continue

        report = verify_recovery(simulator)
        for check in report.checks:
            emit("verification_check", Actor.VERIFIER, check.model_dump(mode="json"))
        emit("verification_result", Actor.VERIFIER, report.model_dump(mode="json"))

        if report.all_passed:
            outcome = Outcome.VERIFIED
            summary = "All three independent recovery checks passed."
            break

    emit("outcome", Actor.SYSTEM, {"outcome": outcome.value, "summary": summary})
    return IncidentResponse(
        incident_id=incident_id,
        scenario=request.scenario,
        client=request.client,
        outcome=outcome,
        summary=summary,
        mode="fallback",
        events=events,
    )
