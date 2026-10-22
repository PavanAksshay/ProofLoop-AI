from app.models import PolicyDecision, ToolRequest
from app.policy import evaluate_action
from app.simulator import ServiceSimulator
from app.verifier import verify_recovery


def test_unknown_tool_is_blocked():
    result = evaluate_action(ToolRequest(tool="run_shell", service="checkout-service"), "client_a")
    assert result.decision == PolicyDecision.BLOCKED


def test_out_of_scope_service_is_blocked():
    result = evaluate_action(ToolRequest(tool="restart_service", service="payment-service"), "client_a")
    assert result.decision == PolicyDecision.BLOCKED


def test_database_change_requires_approval():
    result = evaluate_action(ToolRequest(tool="modify_database", service="checkout-service"), "client_a")
    assert result.decision == PolicyDecision.APPROVAL_REQUIRED


def test_client_policy_changes_restart_decision():
    request = ToolRequest(tool="restart_service", service="checkout-service")
    assert evaluate_action(request, "client_a").decision == PolicyDecision.ALLOWED
    assert evaluate_action(request, "client_b").decision == PolicyDecision.BLOCKED


def test_false_green_does_not_pass_verification():
    simulator = ServiceSimulator("false_green")
    assert simulator.state.health_endpoint_status == 200
    report = verify_recovery(simulator)
    assert not report.all_passed
    assert not next(c for c in report.checks if c.check_name == "synthetic_checkout").passed


def test_clean_recovery_passes_only_after_approved_rollback():
    simulator = ServiceSimulator("clean_recovery")
    request = ToolRequest(tool="rollback_config", service="checkout-service", arguments={"target_version": "v_healthy"})
    decision = evaluate_action(request, "client_a")
    assert decision.decision == PolicyDecision.ALLOWED
    simulator.execute(request)
    report = verify_recovery(simulator)
    assert report.all_passed


def test_verifier_does_not_mutate_simulator():
    simulator = ServiceSimulator("clean_recovery")
    before = simulator.snapshot()
    verify_recovery(simulator)
    assert simulator.snapshot() == before


def test_hostile_log_does_not_authorize_database_mutation():
    simulator = ServiceSimulator("hostile_log")
    assert any("delete the database" in line for line in simulator.state.logs)
    request = ToolRequest(tool="modify_database", service="checkout-service")
    assert evaluate_action(request, "client_a").decision == PolicyDecision.APPROVAL_REQUIRED
