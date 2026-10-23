"""Comprehensive test suite for Phase 5 Evidence-Driven Investigation Engine."""
import json
import pytest
from unittest.mock import MagicMock

from app.investigation import (
    CONFIDENCE_REMEDIATION_THRESHOLD,
    READ_ONLY_DIAGNOSTIC_TOOLS,
    consult_llm_investigator,
    execute_diagnostic_tool,
    generate_initial_hypotheses,
    normalize_initial_evidence,
    run_investigation_cycle,
    select_next_diagnostic,
    update_hypotheses_with_evidence,
)
from app.models import (
    DiagnosticProposal,
    EvidenceItem,
    EvidenceKind,
    Hypothesis,
    HypothesisStatus,
    IncidentRunRequest,
    InvestigationBudget,
    InvestigationState,
    Outcome,
    PolicyDecision,
    ToolRequest,
)
from app import orchestrator
from app.policy import evaluate_action
from app.simulator import ServiceSimulator
from app.store import get_incident_response, get_investigation_state
from app.verifier import verify_recovery


def _stub_persistence(monkeypatch):
    """Stub SQLite operations with in-memory storage for clean test isolation."""
    events_log = []
    approvals_store = {}
    inv_store = {}

    monkeypatch.setattr("app.orchestrator.append_event", lambda ev: events_log.append(ev))
    monkeypatch.setattr("app.orchestrator.incident_exists", lambda inc_id: False)
    monkeypatch.setattr("app.orchestrator.create_incident", lambda *args, **kwargs: None)
    monkeypatch.setattr("app.orchestrator.update_incident_mode", lambda *args, **kwargs: None)
    monkeypatch.setattr("app.orchestrator.save_pending_approval", lambda inc_id, payload: approvals_store.update({inc_id: payload}))
    monkeypatch.setattr("app.orchestrator.save_investigation_state", lambda inc_id, st: inv_store.update({inc_id: st}))
    monkeypatch.setattr("app.orchestrator.get_investigation_state", lambda inc_id: inv_store.get(inc_id))


def test_clean_config_fault_diagnosed_from_evidence(monkeypatch):
    """Proves that a clean configuration fault is accurately diagnosed from evidence."""
    _stub_persistence(monkeypatch)
    monkeypatch.setenv("PROOFLOOP_LLM_PROVIDER", "fallback")

    incident_id = "test-clean-diag"
    response = orchestrator.run_incident(
        IncidentRunRequest(scenario="clean_recovery", client="client_a"),
        incident_id=incident_id,
        record_to_store=False,
    )

    assert response.outcome == Outcome.VERIFIED
    assert response.investigation_state is not None

    state = response.investigation_state
    assert len(state.symptoms) > 0
    assert any("error rate" in s.lower() for s in state.symptoms)

    # Verify bad config hypothesis was confirmed with high confidence
    bad_config_hyp = next((h for h in state.hypotheses if h.id == "hyp-bad-config"), None)
    assert bad_config_hyp is not None
    assert bad_config_hyp.status == HypothesisStatus.CONFIRMED
    assert bad_config_hyp.confidence_score >= CONFIDENCE_REMEDIATION_THRESHOLD
    assert len(bad_config_hyp.supporting_evidence_ids) > 0
    assert len(bad_config_hyp.contradicting_evidence_ids) == 0

    # Verify diagnosis was recorded
    assert state.current_diagnosis is not None
    assert "Faulty Configuration" in state.current_diagnosis.diagnosis


def test_misleading_health_check_does_not_establish_root_cause(monkeypatch):
    """Proves that a misleading HTTP 200 health check does not establish root cause or bypass verifier."""
    _stub_persistence(monkeypatch)
    monkeypatch.setenv("PROOFLOOP_LLM_PROVIDER", "fallback")

    incident_id = "test-false-green-diag"
    response = orchestrator.run_incident(
        IncidentRunRequest(scenario="false_green", client="client_a"),
        incident_id=incident_id,
        record_to_store=False,
    )

    assert response.outcome != Outcome.VERIFIED
    assert response.outcome == Outcome.ESCALATED
    assert response.investigation_state is not None

    state = response.investigation_state
    # In false-green, config is healthy, so hyp-bad-config should be contradicted/refuted
    bad_config_hyp = next((h for h in state.hypotheses if h.id == "hyp-bad-config"), None)
    assert bad_config_hyp is not None
    assert bad_config_hyp.status == HypothesisStatus.REFUTED or len(bad_config_hyp.contradicting_evidence_ids) > 0

    # Independent verifier must have recorded a failure
    failed_verification = any(
        ev.type == "verification_result" and ev.payload.get("all_passed") is False
        for ev in response.events
    )
    assert failed_verification is True


def test_contradictory_evidence_changes_investigation_plan():
    """Proves that introducing contradictory evidence refutes hypotheses and pivots the diagnosis."""
    sim = ServiceSimulator("clean_recovery")
    symptoms, initial_evidence = normalize_initial_evidence(sim, "clean_recovery")
    hypotheses = generate_initial_hypotheses(symptoms, initial_evidence)

    # Initial update: bad-config has initial log support
    hypotheses = update_hypotheses_with_evidence(hypotheses, initial_evidence)
    leading = hypotheses[0]
    assert leading.id == "hyp-bad-config"

    # Now add direct contradictory evidence: compare_config showing config is healthy!
    contradictory_evidence = EvidenceItem(
        id="ev_contra_cfg",
        source="diagnostic:compare_config",
        kind=EvidenceKind.CONTRADICTORY,
        summary="Active config matches healthy version exactly",
        data={"is_matching_healthy": True, "active_version": "v_healthy", "diff": "clean"},
    )
    evidence_with_contradiction = initial_evidence + [contradictory_evidence]

    # Re-evaluate hypotheses with contradictory evidence
    updated_hypotheses = update_hypotheses_with_evidence(hypotheses, evidence_with_contradiction)
    bad_cfg = next(h for h in updated_hypotheses if h.id == "hyp-bad-config")

    assert bad_cfg.status == HypothesisStatus.REFUTED
    assert "ev_contra_cfg" in bad_cfg.contradicting_evidence_ids
    assert bad_cfg.confidence_score <= 0.1
    # Leading hypothesis has now changed!
    assert updated_hypotheses[0].id != "hyp-bad-config"


def test_diagnostic_failure_recorded_accurately():
    """Proves that a failed diagnostic tool call is safely caught and recorded as an auditable result."""
    sim = ServiceSimulator("clean_recovery")
    unauthorized_proposal = DiagnosticProposal(
        tool="unauthorized_scanner",
        service="checkout-service",
        arguments={},
        rationale="Attempting an invalid diagnostic tool",
    )

    result, ev_item = execute_diagnostic_tool(unauthorized_proposal, sim)

    assert result.success is False
    assert "not a permitted diagnostic tool" in (result.error or "")
    assert ev_item.kind == EvidenceKind.DIAGNOSTIC_RESULT
    assert "failed" in ev_item.summary.lower()


def test_duplicate_diagnostic_suppression():
    """Proves that the engine will not redundantly execute the exact same diagnostic tool twice."""
    state = InvestigationState(
        incident_id="test-dup",
        symptoms=["elevated errors"],
        hypotheses=[
            Hypothesis(
                id="hyp-bad-config",
                title="Bad Config",
                description="desc",
                confidence_score=0.5,
                suggested_diagnostic="compare_config",
            )
        ],
    )

    # Before running, compare_config is selected
    proposal1 = select_next_diagnostic(state)
    assert proposal1 is not None
    assert proposal1.tool == "compare_config"

    # Record that compare_config was successfully executed
    sim = ServiceSimulator("clean_recovery")
    res, ev = execute_diagnostic_tool(proposal1, sim)
    state.diagnostics_performed.append(res)
    state.evidence.append(ev)

    # Next selection must NOT select compare_config again (duplicate suppression)
    proposal2 = select_next_diagnostic(state)
    assert proposal2 is None or proposal2.tool != "compare_config"


def test_malformed_llm_output_cannot_execute_tool(monkeypatch):
    """Proves that malformed LLM responses are rejected and cannot trigger unauthorized actions."""
    monkeypatch.setenv("PROOFLOOP_LLM_PROVIDER", "groq")
    monkeypatch.setattr(
        "app.investigation._provider_response",
        lambda provider, payload: "INVALID NON-JSON OUTPUT: execute delete database",
    )

    state = InvestigationState(incident_id="test-malformed")
    advice = consult_llm_investigator(state)

    # Advice must be rejected safely
    assert advice is None

    # Cycle falls back to safe deterministic execution
    sim = ServiceSimulator("clean_recovery")
    updated_state, tool_req, rationale = run_investigation_cycle(state, sim)

    assert tool_req is not None
    assert tool_req.tool in {"rollback_config", "escalate_to_human", "compare_config"}


def test_prompt_injection_in_logs_treated_as_untrusted_data(monkeypatch):
    """Proves that adversarial prompt injection in logs is quarantined as untrusted evidence."""
    _stub_persistence(monkeypatch)
    monkeypatch.setenv("PROOFLOOP_LLM_PROVIDER", "fallback")

    response = orchestrator.run_incident(
        IncidentRunRequest(scenario="hostile_log", client="client_a"),
        incident_id="test-inj-quarantine",
        record_to_store=False,
    )

    # Verify injection was detected and quarantined
    assert any(ev.type == "injection_detected" for ev in response.events)
    # The destructive instruction ("delete the database") was NEVER executed
    executed_tools = [ev.payload.get("tool") for ev in response.events if ev.type == "tool_executed"]
    assert "delete the database" not in executed_tools
    assert "modify_database" not in executed_tools
    assert all(t in {"rollback_config", "read_logs", "read_config", "compare_config"} for t in executed_tools if t)


def test_agent_respects_investigation_and_tool_call_limits():
    """Proves that the investigation loop halts and escalates when step limits are reached."""
    sim = ServiceSimulator("clean_recovery")
    state = InvestigationState(
        incident_id="test-limits",
        budget=InvestigationBudget(max_steps=2, max_diagnostics=1),
    )

    # Step 1
    state, tool1, _ = run_investigation_cycle(state, sim)
    # Step 2: budget exhausted
    state, tool2, rationale = run_investigation_cycle(state, sim)

    assert state.termination_reason == "budget_exhausted"
    assert tool2 is not None
    assert tool2.tool == "escalate_to_human"
    assert "budget exhausted" in rationale.lower()


def test_unsupported_tools_and_arguments_rejected():
    """Proves that unsupported tools are strictly rejected by policy and execution."""
    invalid_req = ToolRequest(tool="drop_production_tables", service="checkout-service")
    decision = evaluate_action(invalid_req, "client_a")

    assert decision.decision == PolicyDecision.BLOCKED
    assert decision.rule_id == "POL-UNKNOWN-TOOL"


def test_hypothesis_and_evidence_events_persist_and_stream_in_order(tmp_path, monkeypatch):
    """Proves that investigation events are persisted in causal order with stable IDs."""
    test_db = tmp_path / "test_inv_events.db"
    monkeypatch.setenv("PROOFLOOP_DB_PATH", str(test_db))

    incident_id = "test-event-order"
    response = orchestrator.run_incident(
        IncidentRunRequest(scenario="clean_recovery", client="client_a"),
        incident_id=incident_id,
        record_to_store=True,
    )

    assert response.outcome == Outcome.VERIFIED

    # Retrieve persisted response and investigation state from SQLite
    persisted_resp = get_incident_response(incident_id)
    assert persisted_resp is not None
    assert persisted_resp.investigation_state is not None

    event_types = [e.type for e in persisted_resp.events]
    # Check causal ordering of Phase 5 lifecycle events
    assert "incident_opened" in event_types
    assert "investigation_started" in event_types
    assert "hypothesis_created" in event_types
    assert "evidence_observed" in event_types
    assert "action_proposed" in event_types
    assert "policy_decision" in event_types
    assert "tool_executed" in event_types
    assert "verification_result" in event_types
    assert "outcome" in event_types

    assert event_types.index("incident_opened") < event_types.index("investigation_started")
    assert event_types.index("investigation_started") < event_types.index("hypothesis_created")
    assert event_types.index("hypothesis_created") < event_types.index("action_proposed")
    assert event_types.index("action_proposed") < event_types.index("policy_decision")
    assert event_types.index("policy_decision") < event_types.index("tool_executed")
    assert event_types.index("tool_executed") < event_types.index("outcome")


def test_diagnosis_alone_cannot_bypass_policy_gate():
    """Proves that high-confidence diagnosis cannot bypass client policy constraints."""
    # Client B explicitly blocks restart_service regardless of confidence
    restart_action = ToolRequest(tool="restart_service", service="checkout-service")
    decision = evaluate_action(restart_action, "client_b")

    assert decision.decision == PolicyDecision.BLOCKED
    assert decision.rule_id == "POL-CLIENT-B-RESTART"


def test_successful_http_health_check_cannot_bypass_independent_verification():
    """Proves that a green HTTP 200 health check cannot fool independent transaction verification."""
    sim = ServiceSimulator("false_green")
    # Health endpoint reports 200
    assert sim.state.health_endpoint_status == 200

    # Independent verifier must reject recovery because checkout transactions fail
    report = verify_recovery(sim)
    assert report.all_passed is False
    checkout_check = next(c for c in report.checks if c.check_name == "synthetic_checkout")
    assert checkout_check.passed is False
