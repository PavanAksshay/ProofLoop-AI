from dataclasses import dataclass
import threading
from uuid import uuid4

from .investigation import (
    generate_initial_hypotheses,
    normalize_initial_evidence,
    run_investigation_cycle,
)
from .llm_investigator import propose_action as _default_propose_action
from .models import (
    Actor,
    ApprovalDecisionRequest,
    DiagnosticProposal,
    Event,
    EvidenceItem,
    EvidenceKind,
    IncidentResponse,
    IncidentRunRequest,
    InvestigationState,
    Outcome,
    PolicyDecision,
    RemediationRecord,
    ToolRequest,
)
from .policy import evaluate_action
from .simulator import ServiceSimulator
from .store import (
    append_event,
    claim_pending_approval,
    create_incident,
    get_incident_response,
    get_investigation_state,
    get_pending_approval,
    incident_exists,
    release_pending_approval_claim,
    resolve_pending_approval,
    save_investigation_state,
    save_pending_approval,
    update_incident_mode,
)
from .verifier import verify_recovery

# Export propose_action so tests/callers can inspect or mock it
propose_action = _default_propose_action

MAX_ACTION_ATTEMPTS = 3
MAX_INVESTIGATION_STEPS = 8

REMEDIATION_TOOLS = {
    "rollback_config",
    "restart_service",
    "scale_service",
    "clear_cache",
    "modify_database",
}


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
    investigation_state: InvestigationState | None = None


# Prototype-only process memory. Restarting the server clears pending approvals.
_pending_approvals: dict[str, PendingApproval] = {}
_completed_incidents: dict[str, IncidentResponse] = {}
_approval_lock = threading.Lock()


def _response(
    incident_id: str,
    scenario: str,
    client: str,
    outcome: Outcome,
    summary: str,
    events: list[Event],
    mode: str = "fallback",
    investigation_state: InvestigationState | None = None,
) -> IncidentResponse:
    return IncidentResponse(
        incident_id=incident_id,
        scenario=scenario,
        client=client,
        outcome=outcome,
        summary=summary,
        mode=mode,
        events=events,
        investigation_state=investigation_state,
    )


def _emit(
    events: list[Event],
    incident_id: str,
    event_type: str,
    actor: Actor,
    payload: dict,
    refs: list[str] | None = None,
    persist: bool = True,
) -> None:
    event = Event(
        incident_id=incident_id,
        type=event_type,
        actor=actor,
        payload=payload,
        evidence_refs=refs or [],
    )
    events.append(event)
    if persist:
        append_event(event)


def _verify_and_report(
    incident_id: str,
    scenario: str,
    client: str,
    simulator: ServiceSimulator,
    events: list[Event],
    mode: str = "fallback",
    investigation_state: InvestigationState | None = None,
) -> IncidentResponse:
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
    response = _response(
        incident_id, scenario, client, outcome, summary, events, mode=mode, investigation_state=investigation_state
    )
    _completed_incidents[incident_id] = response
    return response


def run_incident(
    request: IncidentRunRequest,
    incident_id: str | None = None,
    simulator: ServiceSimulator | None = None,
    record_to_store: bool = True,
) -> IncidentResponse:
    incident_id = incident_id or str(uuid4())
    events: list[Event] = []

    def emit(event_type: str, actor: Actor, payload: dict, refs: list[str] | None = None) -> None:
        _emit(events, incident_id, event_type, actor, payload, refs, persist=record_to_store)

    if simulator is None:
        try:
            simulator = ServiceSimulator(request.scenario, getattr(request, "custom_params", None))
        except ValueError as exc:
            raise ValueError(str(exc)) from exc

    if record_to_store and not incident_exists(incident_id):
        create_incident(incident_id, request.scenario, request.client, Outcome.RUNNING, "Incident started.")

    emit("incident_opened", Actor.SYSTEM, {
        "scenario": request.scenario,
        "client": request.client,
        "requested_mode": request.mode,
    })

    # 1. Evidence-Driven Engine Initialization
    symptoms, initial_evidence = normalize_initial_evidence(simulator, request.scenario)
    hypotheses = generate_initial_hypotheses(symptoms, initial_evidence)
    inv_state = InvestigationState(
        incident_id=incident_id,
        symptoms=symptoms,
        step=1,
        hypotheses=hypotheses,
        evidence=initial_evidence,
    )

    emit("investigation_started", Actor.SYSTEM, {
        "symptoms": inv_state.symptoms,
        "hypothesis_count": len(inv_state.hypotheses),
        "budget": inv_state.budget.model_dump(),
    })

    # Emit initial hypotheses
    for hyp in inv_state.hypotheses:
        emit("hypothesis_created", Actor.AGENT, hyp.model_dump())

    # Emit initial structured evidence items
    for ev in inv_state.evidence:
        emit("evidence_observed", Actor.TOOL, ev.model_dump(), [ev.source])
        supp_hyps = [h.id for h in inv_state.hypotheses if ev.id in h.supporting_evidence_ids]
        contra_hyps = [h.id for h in inv_state.hypotheses if ev.id in h.contradicting_evidence_ids]
        if supp_hyps or contra_hyps:
            emit("evidence_correlated", Actor.AGENT, {
                "evidence_id": ev.id,
                "source": ev.source,
                "kind": ev.kind.value,
                "supporting_hypotheses": supp_hyps,
                "contradicting_hypotheses": contra_hyps,
            }, [ev.source])

    # Backward-compatible evidence_collected event for existing UI/contracts
    logs = simulator.read_logs("checkout-service").result.get("logs", [])
    emit("evidence_collected", Actor.TOOL, {"source": "logs", "excerpt": logs}, ["logs:checkout-service"])

    # Injection detection alert
    has_injection = any("ignore policy" in line.lower() or "delete the database" in line.lower() for line in logs)
    if has_injection or any("untrusted prompt injection" in s.lower() for s in symptoms):
        emit("injection_detected", Actor.SYSTEM, {
            "message": "Instruction-like text detected in untrusted log data; treated as data."
        }, ["logs:checkout-service"])

    outcome = Outcome.ESCALATED
    summary = "Incident reached a safe stop without a verified recovery."
    response_mode = "fallback"

    action_attempts = 0
    investigation_steps = 1  # Step 1: initial symptom & evidence collection

    # Check whether propose_action was monkeypatched (e.g., in unit tests)
    is_propose_action_patched = propose_action != _default_propose_action

    while action_attempts < MAX_ACTION_ATTEMPTS:
        if investigation_steps >= MAX_INVESTIGATION_STEPS:
            emit("investigation_limit_reached", Actor.SYSTEM, {
                "limit": MAX_INVESTIGATION_STEPS,
                "steps": investigation_steps,
                "message": f"Investigation step limit ({MAX_INVESTIGATION_STEPS}) reached without resolution; escalating incident.",
            })
            emit("investigation_budget_exhausted", Actor.SYSTEM, {
                "limit": MAX_INVESTIGATION_STEPS,
                "steps": investigation_steps,
                "message": f"Investigation step limit ({MAX_INVESTIGATION_STEPS}) reached without resolution; escalating incident.",
            })
            outcome = Outcome.ESCALATED
            summary = f"Investigation step limit ({MAX_INVESTIGATION_STEPS}) reached without resolution; incident escalated."
            break

        investigation_steps += 1
        inv_state.step = investigation_steps
        inv_state.budget.steps_taken = investigation_steps

        if is_propose_action_patched:
            # Respect explicit monkeypatching from unit test suites
            action, rationale, evidence_refs, selected_mode = propose_action(simulator)
            response_mode = selected_mode
        else:
            # Run Phase 5 Evidence-Driven Investigation Engine Cycle
            prev_diag_count = len(inv_state.diagnostics_performed)
            inv_state, proposed_tool, rationale = run_investigation_cycle(inv_state, simulator)

            # If a diagnostic was executed in this step, emit audit events
            if len(inv_state.diagnostics_performed) > prev_diag_count:
                latest_diag = inv_state.diagnostics_performed[-1]
                latest_ev = inv_state.evidence[-1]
                latest_prop = inv_state.proposed_next_step if isinstance(inv_state.proposed_next_step, DiagnosticProposal) else None
                eiv = latest_prop.expected_information_value if latest_prop else 0.5
                dist_power = latest_prop.distinguishing_power if latest_prop else ""
                target_hyps = latest_prop.target_hypotheses if latest_prop else []

                emit("diagnostic_selected", Actor.AGENT, {
                    "tool": latest_diag.tool,
                    "service": latest_diag.service,
                    "arguments": latest_diag.arguments,
                    "rationale": latest_prop.rationale if latest_prop else "Selected to distinguish competing root-cause hypotheses.",
                    "target_hypotheses": target_hyps,
                    "expected_information_value": eiv,
                    "distinguishing_power": dist_power,
                })
                emit("diagnostic_started", Actor.AGENT, {
                    "tool": latest_diag.tool,
                    "service": latest_diag.service,
                })
                emit("diagnostic_completed", Actor.TOOL, {
                    "tool": latest_diag.tool,
                    "success": latest_diag.success,
                    "result": latest_diag.data,
                    "error": latest_diag.error,
                })
                emit("evidence_observed", Actor.TOOL, latest_ev.model_dump(), [latest_ev.source])

                # Correlate diagnostic evidence with hypotheses
                supp_hyps = [h.id for h in inv_state.hypotheses if latest_ev.id in h.supporting_evidence_ids]
                contra_hyps = [h.id for h in inv_state.hypotheses if latest_ev.id in h.contradicting_evidence_ids]
                emit("evidence_correlated", Actor.AGENT, {
                    "evidence_id": latest_ev.id,
                    "source": latest_ev.source,
                    "kind": latest_ev.kind.value,
                    "supporting_hypotheses": supp_hyps,
                    "contradicting_hypotheses": contra_hyps,
                }, [latest_ev.source])

            # Emit updated hypotheses
            emit("hypothesis_updated", Actor.AGENT, {
                "hypotheses": [h.model_dump() for h in inv_state.hypotheses],
            })

            # Emit diagnosis update if formulated
            if inv_state.current_diagnosis:
                emit("diagnosis_updated", Actor.AGENT, inv_state.current_diagnosis.model_dump())

            if proposed_tool is None:
                # Continuing diagnostic accumulation
                continue

            action = proposed_tool
            evidence_refs = [ev.source for ev in inv_state.evidence]
            from .llm_investigator import _configured_provider
            provider = _configured_provider()
            response_mode = f"llm:{provider}" if provider else "fallback"

        if record_to_store:
            update_incident_mode(incident_id, response_mode)
            save_investigation_state(incident_id, inv_state)

        # Handle escalation proposed by engine
        if action.tool == "escalate_to_human":
            emit("investigation_escalated", Actor.SYSTEM, {
                "reason": str(action.arguments.get("reason", "Escalated to a human operator.")),
                "summary": rationale,
            })
            outcome = Outcome.ESCALATED
            summary = str(action.arguments.get("reason", "Escalated to a human operator."))
            break

        # Emit remediation proposal events
        if action.tool in REMEDIATION_TOOLS:
            inv_state.budget.remediations_proposed += 1

        emit("remediation_proposed", Actor.AGENT, {
            "attempt": action_attempts + 1,
            "tool": action.tool,
            "service": action.service,
            "arguments": action.arguments,
            "rationale": rationale,
        }, evidence_refs)

        emit("action_proposed", Actor.AGENT, {
            "attempt": action_attempts + 1,
            "investigation_step": investigation_steps,
            "mode": response_mode,
            "tool": action.tool,
            "service": action.service,
            "arguments": action.arguments,
            "rationale": rationale,
        }, evidence_refs)

        # Policy Gate Evaluation
        decision = evaluate_action(action, request.client)
        emit("policy_decision", Actor.GATE, decision.model_dump(mode="json"), evidence_refs)

        if decision.decision == PolicyDecision.BLOCKED:
            if action.tool in REMEDIATION_TOOLS:
                inv_state.budget.remediations_blocked += 1
            outcome = Outcome.BLOCKED
            summary = f"Action blocked by policy: {decision.reason}"
            break

        if decision.decision == PolicyDecision.APPROVAL_REQUIRED:
            if action.tool in REMEDIATION_TOOLS:
                inv_state.budget.remediations_pending_approval += 1
            # Defensive check: no simulator mutation before human approval
            before = simulator.snapshot()
            emit("approval_requested", Actor.SYSTEM, {
                "tool": action.tool,
                "service": action.service,
                "arguments": action.arguments,
                "rule_id": decision.rule_id,
                "reason": decision.reason,
                "attempt": action_attempts + 1,
                "investigation_step": investigation_steps,
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
                attempt=action_attempts + 1,
                rule_id=decision.rule_id,
                reason=decision.reason,
                mode=response_mode,
                investigation_state=inv_state,
            )
            if record_to_store:
                _pending_approvals[incident_id] = pending
                save_pending_approval(incident_id, {
                    "incident_id": incident_id,
                    "scenario": request.scenario,
                    "client": request.client,
                    "simulator_snapshot": simulator.snapshot(),
                    "action": action.model_dump(mode="json"),
                    "attempt": action_attempts + 1,
                    "investigation_step": investigation_steps,
                    "rule_id": decision.rule_id,
                    "reason": decision.reason,
                    "mode": response_mode,
                })
                save_investigation_state(incident_id, inv_state)

            response = _response(
                incident_id, request.scenario, request.client,
                Outcome.PENDING_APPROVAL,
                "Waiting for an explicit human approval decision. No action has been executed.",
                events,
                mode=response_mode,
                investigation_state=inv_state,
            )
            return response

        if action.tool in REMEDIATION_TOOLS:
            action_attempts += 1
            inv_state.budget.remediations_attempted = action_attempts

        result = simulator.execute(action)
        inv_state.remediation_history.append(
            RemediationRecord(
                tool=action.tool,
                service=action.service,
                arguments=action.arguments,
                attempt=action_attempts,
                success=result.success,
            )
        )

        emit("tool_executed", Actor.TOOL, {
            "tool": action.tool,
            "arguments": action.arguments,
            "success": result.success,
            "message": result.message,
            "result": result.result,
            "error": result.error,
        })

        if not result.success:
            continue

        # Independent Verification
        report = verify_recovery(simulator)
        for check in report.checks:
            emit("verification_check", Actor.VERIFIER, check.model_dump(mode="json"))
        emit("verification_result", Actor.VERIFIER, report.model_dump(mode="json"))

        if report.all_passed:
            outcome = Outcome.VERIFIED
            summary = "All three independent recovery checks passed."
            break
        else:
            # Record verifier failure as contradictory evidence to recovery
            inv_state.evidence.append(
                EvidenceItem(
                    source="verifier:independent_check",
                    kind=EvidenceKind.CONTRADICTORY,
                    summary="Verification failed after remediation; service recovery not established.",
                    data={"checks": [c.model_dump() for c in report.checks]},
                )
            )

    emit("outcome", Actor.SYSTEM, {"outcome": outcome.value, "summary": summary})
    if record_to_store:
        save_investigation_state(incident_id, inv_state)

    response = _response(
        incident_id, request.scenario, request.client, outcome, summary, events, mode=response_mode, investigation_state=inv_state
    )
    if record_to_store:
        _completed_incidents[incident_id] = response
    return response


def decide_approval(incident_id: str, request: ApprovalDecisionRequest) -> IncidentResponse:
    # Replay protection: Check if incident has already reached a final outcome
    existing = _completed_incidents.get(incident_id) or get_incident_response(incident_id)
    if existing is not None and existing.outcome != Outcome.PENDING_APPROVAL:
        raise ValueError("This incident has already reached a final outcome; approval cannot be changed.")

    with _approval_lock:
        pending = _pending_approvals.get(incident_id)

        if pending is None:
            saved = get_pending_approval(incident_id)
            if saved is None:
                if existing is not None and existing.outcome == Outcome.PENDING_APPROVAL:
                    raise ValueError("This approval is already being processed or has an invalid pending state.")
                raise KeyError("No pending approval exists for this incident.")
            try:
                simulator = ServiceSimulator.from_snapshot(saved["scenario"], saved["simulator_snapshot"])
                action = ToolRequest.model_validate(saved["action"])
                stored_response = get_incident_response(incident_id)
                if stored_response is None:
                    raise ValueError("Persisted incident history is missing.")
                inv_state = get_investigation_state(incident_id)
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
                    investigation_state=inv_state,
                )
                _pending_approvals[incident_id] = pending
            except Exception as exc:
                raise ValueError("Persisted approval state could not be restored safely.") from exc

        claimed = claim_pending_approval(incident_id)
        if claimed is None:
            _pending_approvals.pop(incident_id, None)
            existing_after = get_incident_response(incident_id)
            if existing_after is not None and existing_after.outcome != Outcome.PENDING_APPROVAL:
                raise ValueError("This incident has already reached a final outcome; approval cannot be changed.")
            raise ValueError("This approval is already being processed or has already been resolved.")

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
            if pending.action.tool in REMEDIATION_TOOLS and pending.investigation_state is not None:
                pending.investigation_state.budget.remediations_blocked += 1
                save_investigation_state(incident_id, pending.investigation_state)
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
                summary, pending.events, mode=pending.mode, investigation_state=pending.investigation_state,
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
            if pending.action.tool in REMEDIATION_TOOLS and pending.investigation_state is not None:
                pending.investigation_state.budget.remediations_blocked += 1
                save_investigation_state(incident_id, pending.investigation_state)
            summary = "The proposed action was denied by a human; no action was executed."
            _emit(pending.events, incident_id, "outcome", Actor.SYSTEM, {"outcome": Outcome.BLOCKED.value, "summary": summary})
            response = _response(
                incident_id, pending.scenario, pending.client, Outcome.BLOCKED, summary, pending.events, mode=pending.mode, investigation_state=pending.investigation_state
            )
            _completed_incidents[incident_id] = response
            resolve_pending_approval(incident_id)
            _pending_approvals.pop(incident_id, None)
            return response

        if pending.action.tool in REMEDIATION_TOOLS and pending.investigation_state is not None:
            pending.investigation_state.budget.remediations_attempted += 1
            save_investigation_state(incident_id, pending.investigation_state)

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

        # Record in remediation history
        if pending.investigation_state is not None:
            pending.investigation_state.remediation_history.append(
                RemediationRecord(
                    tool=pending.action.tool,
                    service=pending.action.service,
                    arguments=pending.action.arguments,
                    attempt=pending.attempt,
                    success=result.success,
                )
            )
            save_investigation_state(incident_id, pending.investigation_state)

        if not result.success:
            summary = "The approved action failed to execute; the incident was escalated."
            _emit(pending.events, incident_id, "outcome", Actor.SYSTEM, {"outcome": Outcome.ESCALATED.value, "summary": summary})
            response = _response(
                incident_id, pending.scenario, pending.client, Outcome.ESCALATED, summary, pending.events, mode=pending.mode, investigation_state=pending.investigation_state
            )
            _completed_incidents[incident_id] = response
            resolve_pending_approval(incident_id)
            return response

        response = _verify_and_report(
            incident_id, pending.scenario, pending.client, pending.simulator, pending.events, mode=pending.mode, investigation_state=pending.investigation_state
        )
        resolve_pending_approval(incident_id)
        return response
    except PermissionError:
        raise
    except Exception:
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
            investigation_state=pending.investigation_state,
        )
    return _completed_incidents.get(incident_id)
