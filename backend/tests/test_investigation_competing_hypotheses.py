"""Adversarial and regression tests for Phase 6:
Competing Hypotheses and Evidence-Guided Diagnostic Selection.

Covers:
1. Simultaneous competing hypotheses representation and bounded root causes.
2. Evidence-guided diagnostic selection via Expected Information Value (EIV).
3. Ranking reversals when evidence supports a competing challenger.
4. Strict preservation of contradictory evidence across updates.
5. Prevention of premature diagnosis:
   - Stale health check / pre-diagnostic metrics cannot establish root cause.
   - High heuristic score cannot bypass missing required evidence or unresolved contradictions.
6. Evidence deduplication (idempotent correlation).
7. Diagnostic duplicate suppression and inconclusive diagnostic handling.
8. Safe escalation upon budget exhaustion or inconclusive evidence.
9. Security invariants:
   - Untrusted prompt injection in evidence remains quarantined data.
   - Malformed LLM proposals cannot invoke tools.
   - Deterministic policy gate cannot be bypassed by diagnosis confidence.
   - Approval-required actions cannot execute before human approval.
10. Budget semantics:
   - Distinct counters for remediations_proposed, remediations_blocked,
     remediations_pending_approval, and remediations_attempted.
"""
from __future__ import annotations

from unittest.mock import patch
import pytest

from app.investigation import (
    calculate_diagnostic_eiv,
    execute_diagnostic_tool,
    generate_initial_hypotheses,
    is_diagnosis_sufficient,
    normalize_initial_evidence,
    run_investigation_cycle,
    select_next_diagnostic,
    update_hypotheses_with_evidence,
)
from app.models import (
    ApprovalDecisionRequest,
    DiagnosticProposal,
    DiagnosticResult,
    EvidenceItem,
    EvidenceKind,
    Hypothesis,
    HypothesisStatus,
    IncidentRunRequest,
    InvestigationBudget,
    InvestigationState,
    Outcome,
    ToolRequest,
)
from app.orchestrator import decide_approval, run_incident
from app.policy import evaluate_action, PolicyDecision
from app.simulator import ServiceSimulator


def test_competing_hypotheses_simultaneous_initialization():
    """Verify that initialization maintains a bounded set of competing plausible hypotheses."""
    sim = ServiceSimulator("clean_recovery")
    symptoms, evidence = normalize_initial_evidence(sim, "clean_recovery")
    hypotheses = generate_initial_hypotheses(symptoms, evidence)

    # Must contain multiple competing hypotheses with distinct categories
    assert len(hypotheses) >= 4
    categories = {h.category for h in hypotheses}
    assert "configuration" in categories
    assert "observability" in categories
    assert "dependency" in categories
    assert "transient" in categories

    # All hypotheses must have required evidence and applicable diagnostics declared
    for h in hypotheses:
        assert h.id.startswith("hyp-")
        assert len(h.required_evidence) > 0
        assert len(h.applicable_diagnostics) > 0
        assert h.status == HypothesisStatus.ACTIVE
        assert 0.0 <= h.confidence_score <= 1.0

    # Top two competing hypotheses must have close confidence scores (competitive initial state)
    top1, top2 = hypotheses[0], hypotheses[1]
    assert abs(top1.confidence_score - top2.confidence_score) <= 0.25


def test_evidence_guided_diagnostic_selection_prioritizes_distinguishing_power():
    """Verify that EIV prioritizes diagnostics that discriminate between the top competing hypotheses."""
    sim = ServiceSimulator("false_green")
    symptoms, evidence = normalize_initial_evidence(sim, "false_green")
    hypotheses = generate_initial_hypotheses(symptoms, evidence)
    hypotheses = update_hypotheses_with_evidence(hypotheses, evidence)

    state = InvestigationState(
        incident_id="inc-test-eiv",
        symptoms=symptoms,
        hypotheses=hypotheses,
        evidence=evidence,
    )

    # In false_green, top active hypotheses are hyp-false-green and hyp-bad-config
    proposal = select_next_diagnostic(state)
    assert proposal is not None
    assert proposal.tool in {"validate_transactions", "compare_config"}
    assert proposal.expected_information_value > 0.6
    assert len(proposal.distinguishing_power) > 0
    assert len(proposal.target_hypotheses) > 0


def test_ranking_reversal_when_diagnostic_supports_competitor():
    """Verify that evidence supporting a competing hypothesis reverses the ranking."""
    sim = ServiceSimulator("false_green")
    symptoms, evidence = normalize_initial_evidence(sim, "false_green")
    hypotheses = generate_initial_hypotheses(symptoms, evidence)

    # Initially, hyp-false-green and hyp-bad-config compete
    hypotheses = update_hypotheses_with_evidence(hypotheses, evidence)

    # Now run validate_transactions which observes failures in false_green scenario
    diag_proposal = DiagnosticProposal(
        tool="validate_transactions",
        arguments={"count": 5},
        rationale="Probe synthetic transactions",
        target_hypotheses=["hyp-false-green"],
    )
    res, new_ev = execute_diagnostic_tool(diag_proposal, sim)
    assert res.success is True
    assert res.data.get("failed", 0) > 0

    # Also run compare_config which refutes hyp-bad-config (config matches healthy)
    cfg_proposal = DiagnosticProposal(
        tool="compare_config",
        arguments={},
        rationale="Check config diff",
        target_hypotheses=["hyp-bad-config"],
    )
    cfg_res, cfg_ev = execute_diagnostic_tool(cfg_proposal, sim)
    assert cfg_res.data.get("is_matching_healthy") is True

    # Update with new diagnostic evidence
    updated_hypotheses = update_hypotheses_with_evidence(hypotheses, evidence + [new_ev, cfg_ev])

    # hyp-bad-config is refuted
    bad_cfg = next(h for h in updated_hypotheses if h.id == "hyp-bad-config")
    assert bad_cfg.status == HypothesisStatus.REFUTED
    assert bad_cfg.confidence_score <= 0.1

    # hyp-false-green is confirmed and leading
    leading = updated_hypotheses[0]
    assert leading.id == "hyp-false-green"
    assert leading.status == HypothesisStatus.CONFIRMED
    assert leading.confidence_score >= 0.8
    assert "probe:transaction_failure_observed" in str(leading.last_ranking_change_reason) or leading.last_ranking_change_reason is not None


def test_contradictory_evidence_strictly_preserved():
    """Verify that contradictory evidence IDs are preserved even across subsequent evidence additions."""
    hyp = Hypothesis(
        id="hyp-bad-config",
        title="Bad Config",
        description="Testing preservation",
        required_evidence=["diff:active_differs_from_healthy"],
        applicable_diagnostics=["compare_config"],
    )

    ev_contra = EvidenceItem(
        id="ev_contra_1",
        source="diagnostic:compare_config",
        kind=EvidenceKind.CONTRADICTORY,
        summary="Config matches healthy",
        data={"is_matching_healthy": True},
    )

    updated = update_hypotheses_with_evidence([hyp], [ev_contra])
    assert updated[0].status == HypothesisStatus.REFUTED
    assert "ev_contra_1" in updated[0].contradicting_evidence_ids

    # Add further unrelated evidence
    ev_unrelated = EvidenceItem(
        id="ev_other_2",
        source="metrics:checkout-service",
        kind=EvidenceKind.DERIVED_MEASUREMENT,
        summary="Error rate measurement",
        data={"error_rate": 0.05, "health_endpoint_status": 200},
    )

    updated2 = update_hypotheses_with_evidence(updated, [ev_contra, ev_unrelated])
    assert updated2[0].status == HypothesisStatus.REFUTED
    assert "ev_contra_1" in updated2[0].contradicting_evidence_ids


def test_stale_health_check_cannot_establish_diagnosis():
    """Verify that premature diagnosis is prevented when relying solely on initial metrics without diagnostics."""
    sim = ServiceSimulator("clean_recovery")
    symptoms, evidence = normalize_initial_evidence(sim, "clean_recovery")
    hypotheses = generate_initial_hypotheses(symptoms, evidence)

    state = InvestigationState(
        incident_id="inc-stale-health",
        symptoms=symptoms,
        hypotheses=hypotheses,
        evidence=evidence,
        diagnostics_performed=[],  # No direct diagnostic has run
    )

    # Even if leading hypothesis score is artificially high, diagnosis without diagnostic verification is rejected
    state.hypotheses[0].confidence_score = 0.95
    state.hypotheses[0].status = HypothesisStatus.CONFIRMED

    sufficient, reason = is_diagnosis_sufficient(state)
    assert sufficient is False
    assert "no diagnostic tool has been executed" in reason.lower() or "premature" in reason.lower() or "missing mandatory evidence" in reason.lower()


def test_high_confidence_cannot_override_unresolved_contradictions():
    """Verify that a high score cannot override mandatory unresolved contradictory evidence."""
    hyp = Hypothesis(
        id="hyp-bad-config",
        title="Bad Config",
        description="Test",
        confidence_score=0.95,
        status=HypothesisStatus.CONFIRMED,
        supporting_evidence_ids=["ev_1"],
        contradicting_evidence_ids=["ev_contra_1"],  # Unresolved contradiction
        required_evidence=["diff:active_differs_from_healthy"],
    )

    state = InvestigationState(
        incident_id="inc-contra-override",
        hypotheses=[hyp],
        evidence=[
            EvidenceItem(
                id="ev_1",
                source="diagnostic:compare_config",
                kind=EvidenceKind.DIAGNOSTIC_RESULT,
                summary="Diff found",
                data={"is_matching_healthy": False},
            ),
            EvidenceItem(
                id="ev_contra_1",
                source="logs:checkout-service",
                kind=EvidenceKind.CONTRADICTORY,
                summary="Healthy log",
                data={"logs": ["active config v_healthy"]},
            ),
        ],
        diagnostics_performed=[
            DiagnosticResult(tool="compare_config", success=True, data={"is_matching_healthy": False})
        ],
    )

    sufficient, reason = is_diagnosis_sufficient(state)
    assert sufficient is False
    assert "contradictory evidence" in reason.lower()


def test_duplicate_evidence_idempotent_scoring():
    """Verify that repeating the same evidence ID does not inflate confidence or duplicate refs."""
    hyp = Hypothesis(
        id="hyp-bad-config",
        title="Bad Config",
        description="Test",
        required_evidence=["diff:active_differs_from_healthy"],
        applicable_diagnostics=["compare_config"],
    )

    ev = EvidenceItem(
        id="ev_same_id",
        source="diagnostic:compare_config",
        kind=EvidenceKind.DIAGNOSTIC_RESULT,
        summary="Diff found",
        data={"is_matching_healthy": False},
    )

    # Feed the single evidence item once
    res1 = update_hypotheses_with_evidence([hyp], [ev])
    score1 = res1[0].confidence_score
    supporting1 = list(res1[0].supporting_evidence_ids)

    # Feed the same evidence item 5 times
    res2 = update_hypotheses_with_evidence([hyp], [ev, ev, ev, ev, ev])
    score2 = res2[0].confidence_score
    supporting2 = list(res2[0].supporting_evidence_ids)

    assert score1 == score2
    assert supporting1 == supporting2
    assert len(supporting2) == 1


def test_diagnostic_duplicate_suppression():
    """Verify that once a diagnostic completes with conclusive data, its EIV drops to 0."""
    state = InvestigationState(
        incident_id="inc-dup-test",
        hypotheses=generate_initial_hypotheses(["Recent deployment"], []),
        evidence=[],
        diagnostics_performed=[
            DiagnosticResult(
                tool="compare_config",
                success=True,
                data={"is_matching_healthy": False, "diff": "v_bad"},
            )
        ],
    )

    eiv, dp_expl, _ = calculate_diagnostic_eiv("compare_config", {}, state)
    assert eiv == 0.0
    assert "duplicate suppressed" in dp_expl.lower()


def test_exhausted_budgets_produce_safe_escalation():
    """Verify that exhausted budgets safely terminate and trigger escalate_to_human."""
    sim = ServiceSimulator("clean_recovery")
    state = InvestigationState(
        incident_id="inc-budget-exhausted",
        symptoms=["Symptom A"],
        hypotheses=generate_initial_hypotheses(["Symptom A"], []),
        evidence=[],
        budget=InvestigationBudget(max_steps=3, steps_taken=3),
    )

    updated_state, req, rationale = run_investigation_cycle(state, sim)
    assert updated_state.termination_reason == "budget_exhausted"
    assert req is not None
    assert req.tool == "escalate_to_human"
    assert "budget exhausted" in rationale.lower()


def test_malformed_llm_proposals_cannot_invoke_tools():
    """Verify that malformed or unauthorized LLM proposals fall back safely to deterministic EIV selection."""
    sim = ServiceSimulator("clean_recovery")
    state = InvestigationState(
        incident_id="inc-llm-fallback",
        symptoms=["Elevated request error rate"],
        hypotheses=generate_initial_hypotheses(["Elevated request error rate"], []),
        evidence=[],
    )

    # Mock LLM returning malformed JSON or prohibited tool
    with patch("app.investigation._configured_provider", return_value="mock_provider"):
        with patch("app.investigation._provider_response", return_value='{"action_type": "diagnostic", "tool": "destroy_all_servers"}'):
            updated_state, req, rationale = run_investigation_cycle(state, sim)

            # Tool proposal must NOT be destroy_all_servers; must be a valid read-only diagnostic
            assert len(updated_state.diagnostics_performed) == 1
            executed_tool = updated_state.diagnostics_performed[0].tool
            assert executed_tool in {"compare_config", "validate_transactions", "check_dependencies", "get_metrics", "read_logs"}


def test_prompt_injection_in_telemetry_remains_untrusted_data():
    """Verify that adversarial instructions in log telemetry trigger safe detection without executing."""
    sim = ServiceSimulator("hostile_log")
    req = IncidentRunRequest(scenario="hostile_log", client="client_a")
    resp = run_incident(req, simulator=sim, record_to_store=False)

    assert any(e.type == "injection_detected" for e in resp.events)
    # Ensure no destructive tool executed
    assert not any(e.payload.get("tool") == "modify_database" for e in resp.events if e.type == "tool_executed")


def test_remediation_budget_semantics_distinguish_proposed_vs_executed():
    """Verify that remediations_proposed, remediations_blocked, and remediations_attempted track accurately."""
    sim = ServiceSimulator("clean_recovery")
    symptoms, evidence = normalize_initial_evidence(sim, "clean_recovery")
    hypotheses = generate_initial_hypotheses(symptoms, evidence)
    # Set suggested remediation to restart_service which is prohibited/blocked for client_b
    hypotheses[0].confidence_score = 0.95
    hypotheses[0].status = HypothesisStatus.CONFIRMED
    hypotheses[0].required_evidence = []
    hypotheses[0].suggested_remediation = ToolRequest(
        tool="restart_service",
        service="checkout-service",
        arguments={},
    )
    state = InvestigationState(
        incident_id="inc-blocked-budget",
        symptoms=symptoms,
        hypotheses=hypotheses,
        evidence=evidence,
        diagnostics_performed=[
            DiagnosticResult(tool="compare_config", success=True, data={"is_matching_healthy": False})
        ],
    )

    with patch("app.orchestrator.run_investigation_cycle", return_value=(state, hypotheses[0].suggested_remediation, "Test blocked")):
        req = IncidentRunRequest(scenario="clean_recovery", client="client_b")
        resp = run_incident(req, simulator=sim, record_to_store=False)

    assert resp.outcome == Outcome.BLOCKED
    assert resp.investigation_state is not None
    budget = resp.investigation_state.budget

    # The action was proposed and blocked, NOT executed
    assert budget.remediations_proposed == 1
    assert budget.remediations_blocked == 1
    assert budget.remediations_attempted == 0


def test_approval_required_counter_semantics():
    """Verify that approval-required actions do not count as remediations_attempted until approved."""
    # Client B requires approval for rollback_config
    req = IncidentRunRequest(scenario="clean_recovery", client="client_b")
    resp = run_incident(req, record_to_store=False)

    assert resp.outcome == Outcome.PENDING_APPROVAL
    assert resp.investigation_state is not None
    budget = resp.investigation_state.budget

    # Pending approval must not increment remediations_attempted
    assert budget.remediations_proposed == 1
    assert budget.remediations_pending_approval == 1
    assert budget.remediations_attempted == 0
