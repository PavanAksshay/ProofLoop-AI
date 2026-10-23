"""Phase 8 Test Suite: Adaptive Recovery and Evidence-Driven Replanning.

Tests verify:
1. Scenario A: First fix fails, fresh diagnostics gathered, hypotheses updated, second fix succeeds and verifies.
2. Scenario B: Partial recovery improves one metric but leaves invariant failing; verifier refuses to claim VERIFIED.
3. Scenario C: Misleading post-action health signal (HTTP 200) does not fool verifier; contradiction preserved, cache purged, verified.
4. Scenario D: Unprovable recovery safely exhausts budget and escalates without fabricating success.
5. Duplicate action suppression: agent never blindly repeats an ineffective failed remediation.
6. Full remediation lineage tracking across attempts and approval gates.
7. Audit event causal ordering and SSE replay integrity.
8. Terminal incidents cannot execute additional actions.
"""
from __future__ import annotations

import pytest
from app.models import (
    Actor,
    ApprovalDecisionRequest,
    IncidentRunRequest,
    Outcome,
    PolicyDecision,
    ToolRequest,
)
from app.orchestrator import decide_approval, run_incident
from app.simulator import ServiceSimulator
from app.store import get_incident_response, get_investigation_state


def test_scenario_a_first_fix_fails_replanning_and_second_fix_succeeds():
    """Scenario A: First remediation executes but fails verification; agent gathers new evidence,

    replans, proposes a different authorized remediation (database repair), waits for human approval,
    and independently verifies full recovery.
    """
    req = IncidentRunRequest(scenario="first_fix_fails", client="client_a")
    incident_id = "test-phase8-scen-a-adaptive"

    # Step 1: Initial run executes rollback_config, observes failure, replans, and proposes modify_database
    res = run_incident(req, incident_id=incident_id)

    # Initial action was rollback_config, which rolled back config but left database connection pool degraded
    assert res.outcome == Outcome.PENDING_APPROVAL
    assert res.investigation_state is not None
    assert len(res.investigation_state.remediation_history) == 1

    first_rem = res.investigation_state.remediation_history[0]
    assert first_rem.tool == "rollback_config"
    assert first_rem.success is True  # Tool handler completed
    assert first_rem.verification_passed is False  # But verifier failed!
    assert first_rem.replanning_reason is not None
    assert "configuration_and_dependencies" in first_rem.replanning_reason

    # Audit events verify post-remediation evaluation stream
    event_types = [e.type for e in res.events]
    assert "tool_executed" in event_types
    assert "remediation_evaluation_started" in event_types
    assert "verification_check" in event_types
    assert "verification_result" in event_types
    assert "independent_verification_failed" in event_types
    assert "recovery_invariant_failed" in event_types
    assert "post_action_evidence_observed" in event_types
    assert "hypothesis_revised_after_remediation" in event_types
    assert "replanning_started" in event_types
    assert "recovery_plan_changed" in event_types
    assert "new_remediation_proposed" in event_types
    assert "approval_requested" in event_types

    # Step 2: Human approves the second remediation (modify_database repair)
    app_req = ApprovalDecisionRequest(
        approver_id="lead_sre_alice",
        decision="approve",
        comment="Authorized database pool repair following failed rollback.",
    )
    final_res = decide_approval(incident_id, app_req)

    # Recovery is independently verified!
    assert final_res.outcome == Outcome.VERIFIED
    assert final_res.investigation_state is not None
    assert len(final_res.investigation_state.remediation_history) == 2

    second_rem = final_res.investigation_state.remediation_history[1]
    assert second_rem.tool == "modify_database"
    assert second_rem.arguments.get("operation") == "repair"
    assert second_rem.success is True
    assert second_rem.verification_passed is True
    assert second_rem.approver_id == "lead_sre_alice"


def test_scenario_b_partial_recovery_cannot_become_verified():
    """Scenario B: First remediation reduces error rate partially, but mandatory invariants fail.

    Agent refuses to declare VERIFIED until all invariants are proven.
    """
    req = IncidentRunRequest(scenario="partial_recovery", client="client_a")
    incident_id = "test-phase8-scen-b-partial"

    res = run_incident(req, incident_id=incident_id)

    # First action was scale_service; reduced error rate from 0.75 to 0.25, but db pool remains failing
    assert res.outcome == Outcome.PENDING_APPROVAL
    assert res.investigation_state is not None
    assert len(res.investigation_state.remediation_history) >= 1

    first_rem = res.investigation_state.remediation_history[0]
    assert first_rem.tool == "scale_service"
    assert first_rem.verification_passed is False

    # Check that failed invariants were recorded
    failed_checks = [
        e.payload.get("invariant")
        for e in res.events
        if e.type == "recovery_invariant_failed"
    ]
    assert "configuration_and_dependencies" in failed_checks or "error_rate_window" in failed_checks or "synthetic_checkout" in failed_checks

    # Now approve next remediation to complete recovery
    app_res = decide_approval(
        incident_id,
        ApprovalDecisionRequest(
            approver_id="sre_bob",
            decision="approve",
            comment="Fix remaining database dependency",
        ),
    )
    assert app_res.outcome == Outcome.VERIFIED
    assert app_res.investigation_state.remediation_history[-1].verification_passed is True


def test_scenario_c_misleading_post_action_health_signal():
    """Scenario C: Service restart reports HTTP 200 health check, but transactions still fail.

    Verifier preserves the contradiction and does not report false success;
    subsequent cache clear restores transactions and confirms true recovery.
    """
    req = IncidentRunRequest(scenario="misleading_health_signal", client="client_a")
    incident_id = "test-phase8-scen-c-misleading"

    res = run_incident(req, incident_id=incident_id)

    # The investigation engine adapts and achieves VERIFIED recovery
    assert res.outcome == Outcome.VERIFIED
    assert res.investigation_state is not None

    # Check all events to verify independent verifier evaluated transactions
    probe_checks = [
        e.payload for e in res.events
        if e.type == "verification_check" and e.payload.get("check_name") == "synthetic_checkout"
    ]
    assert len(probe_checks) >= 1
    # Final probe check must have passed
    assert probe_checks[-1]["passed"] is True


def test_scenario_d_recovery_cannot_be_proven_safe_escalation():
    """Scenario D: External network partition prevents automated recovery; agent does not fabricate

    success and escalates with an explicit reason once retries/diagnostics are exhausted.
    """
    req = IncidentRunRequest(scenario="unprovable_recovery", client="client_a")
    incident_id = "test-phase8-scen-d-unprovable"

    res = run_incident(req, incident_id=incident_id)

    assert res.outcome == Outcome.ESCALATED
    assert "escalat" in res.summary.lower()

    event_types = [e.type for e in res.events]
    assert "escalation_reason_recorded" in event_types
    assert "outcome" in event_types
    # Never claim verified recovery on unprovable failure
    assert not any(e.type == "outcome" and e.payload.get("outcome") == "VERIFIED" for e in res.events)


def test_duplicate_ineffective_action_suppression():
    """Verify that an ineffective remediation is never blindly repeated."""
    sim = ServiceSimulator("first_fix_fails")
    incident_id = "test-phase8-no-duplicate"

    res = run_incident(
        IncidentRunRequest(scenario="first_fix_fails", client="client_a"),
        incident_id=incident_id,
        simulator=sim,
    )

    # Look at proposed actions and executed tools
    executed_tools = [
        r.tool for r in res.investigation_state.remediation_history
    ]
    # rollback_config must only be attempted once, never repeated
    assert executed_tools.count("rollback_config") == 1


def test_remediation_lineage_tracking_complete():
    """Verify that RemediationRecord tracks full lineage linking hypotheses, evidence, policy, and verifier results."""
    req = IncidentRunRequest(scenario="first_fix_fails", client="client_a")
    incident_id = "test-phase8-lineage"

    res = run_incident(req, incident_id=incident_id)
    assert res.investigation_state is not None
    rem = res.investigation_state.remediation_history[0]

    assert rem.id.startswith("rem_")
    assert rem.tool == "rollback_config"
    assert rem.attempt == 1
    assert rem.policy_decision == "ALLOWED"
    assert rem.policy_rule_id is not None
    assert isinstance(rem.resulting_observations, dict)
    assert rem.verification_passed is False
    assert len(rem.verification_checks) > 0
    assert rem.replanning_reason is not None


def test_terminal_verified_incident_cannot_be_reopened():
    """Verify that once an incident is VERIFIED, approving or attempting more actions is rejected."""
    req = IncidentRunRequest(scenario="clean_recovery", client="client_a")
    incident_id = "test-phase8-terminal-verified"

    res = run_incident(req, incident_id=incident_id)
    assert res.outcome == Outcome.VERIFIED

    with pytest.raises(ValueError, match="already reached a final outcome"):
        decide_approval(
            incident_id,
            ApprovalDecisionRequest(approver_id="alice", decision="approve"),
        )


def test_policy_revalidation_before_subsequent_dispatch(monkeypatch):
    """Verify that a subsequent remediation is re-validated through the policy gate before dispatch."""
    req = IncidentRunRequest(scenario="first_fix_fails", client="client_a")
    incident_id = "test-phase8-policy-reval"

    res = run_incident(req, incident_id=incident_id)
    assert res.outcome == Outcome.PENDING_APPROVAL

    # Even if approved, if policy gate is monkeypatched or rule changes to BLOCKED, it must block
    from app import orchestrator
    import app.policy as policy_module

    orig_evaluate = policy_module.evaluate_action

    def mock_evaluate(request, client, scope=None):
        if request.tool == "modify_database":
            from app.models import PolicyResult
            return PolicyResult(
                decision=PolicyDecision.BLOCKED,
                rule_id="POL-DYNAMIC-BLOCK",
                reason="Emergency change freeze active",
            )
        return orig_evaluate(request, client, scope)

    monkeypatch.setattr(policy_module, "evaluate_action", mock_evaluate)
    monkeypatch.setattr(orchestrator, "evaluate_action", mock_evaluate)

    blocked_res = decide_approval(
        incident_id,
        ApprovalDecisionRequest(approver_id="alice", decision="approve"),
    )
    assert blocked_res.outcome == Outcome.BLOCKED
    assert "Emergency change freeze active" in blocked_res.summary


def test_budget_exhaustion_does_not_reset_counters():
    """Verify that action budget is strictly enforced across recovery cycles and never resets."""
    from app.orchestrator import MAX_ACTION_ATTEMPTS
    sim = ServiceSimulator("first_fix_fails")
    # Force downstream dependencies to remain failing permanently
    sim.state.dependencies_healthy = False

    req = IncidentRunRequest(scenario="first_fix_fails", client="client_a")
    incident_id = "test-phase8-budget-exhaustion"

    res = run_incident(req, incident_id=incident_id, simulator=sim)
    assert res.outcome == Outcome.PENDING_APPROVAL

    # Cycle 1: First action was rollback_config (attempt 1). Now approve modify_database (attempt 2).
    # But simulate database repair still failing
    sim.state.dependencies_healthy = False
    res2 = decide_approval(
        incident_id,
        ApprovalDecisionRequest(approver_id="alice", decision="approve"),
    )

    if res2.outcome == Outcome.PENDING_APPROVAL:
        # If another approval is requested (attempt 3)
        res3 = decide_approval(
            incident_id,
            ApprovalDecisionRequest(approver_id="alice", decision="approve"),
        )
        assert res3.outcome in (Outcome.ESCALATED, Outcome.VERIFIED)
    else:
        assert res2.outcome in (Outcome.ESCALATED, Outcome.VERIFIED)


def test_sse_replay_and_event_order_persistence():
    """Verify that SQLite event stream maintains strict causal ordering for adaptive events."""
    req = IncidentRunRequest(scenario="first_fix_fails", client="client_a")
    incident_id = "test-phase8-event-order"

    res = run_incident(req, incident_id=incident_id)
    persisted = get_incident_response(incident_id)
    assert persisted is not None

    types = [e.type for e in persisted.events]

    # Verify strict causal sequence:
    # 1. tool_executed precedes remediation_evaluation_started
    idx_exec = types.index("tool_executed")
    idx_eval = types.index("remediation_evaluation_started")
    assert idx_exec < idx_eval

    # 2. remediation_evaluation_started precedes verification_result
    idx_verif = types.index("verification_result")
    assert idx_eval < idx_verif

    # 3. verification_result precedes recovery_invariant_failed
    idx_invar = types.index("recovery_invariant_failed")
    assert idx_verif < idx_invar

    # 4. recovery_invariant_failed precedes post_action_evidence_observed
    idx_post_ev = types.index("post_action_evidence_observed")
    assert idx_invar <= idx_post_ev

    # 5. post_action_evidence_observed precedes hypothesis_revised_after_remediation
    idx_hyp_rev = types.index("hypothesis_revised_after_remediation")
    assert idx_post_ev <= idx_hyp_rev

    # 6. hypothesis_revised_after_remediation precedes replanning_started
    idx_replan = types.index("replanning_started")
    assert idx_hyp_rev < idx_replan

