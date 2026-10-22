from fastapi.testclient import TestClient

from app.main import app
from app.models import (
    ApprovalDecisionRequest,
    IncidentRunRequest,
    Outcome,
    PolicyDecision,
    ToolRequest,
)
from app.orchestrator import decide_approval, get_incident, run_incident
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


def test_false_green_incident_never_reports_verified():
    response = run_incident(IncidentRunRequest(scenario="false_green", client="client_a"))
    assert response.outcome != Outcome.VERIFIED
    assert any(event.type == "verification_result" for event in response.events)
    assert any(
        event.type == "verification_result" and not event.payload["all_passed"]
        for event in response.events
    )


def test_client_b_incident_waits_for_approval_without_mutation():
    response = run_incident(IncidentRunRequest(scenario="clean_recovery", client="client_b"))
    assert response.outcome == Outcome.PENDING_APPROVAL
    assert any(event.type == "approval_requested" for event in response.events)
    assert not any(event.type == "tool_executed" for event in response.events)
    assert get_incident(response.incident_id).outcome == Outcome.PENDING_APPROVAL


def test_approval_executes_stored_action_and_verifies_recovery():
    response = run_incident(IncidentRunRequest(scenario="clean_recovery", client="client_b"))
    decision = ApprovalDecisionRequest(decision="approve", approver_id="demo-operator", comment="Approved for test")
    completed = decide_approval(response.incident_id, decision)
    assert completed.outcome == Outcome.VERIFIED
    assert any(event.type == "human_approval_decision" for event in completed.events)
    assert any(event.type == "tool_executed" and event.payload.get("approved_by") == "demo-operator" for event in completed.events)


def test_denied_approval_does_not_execute_action():
    response = run_incident(IncidentRunRequest(scenario="clean_recovery", client="client_b"))
    completed = decide_approval(
        response.incident_id,
        ApprovalDecisionRequest(decision="deny", approver_id="demo-operator", comment="Risk too high"),
    )
    assert completed.outcome == Outcome.BLOCKED
    assert not any(event.type == "tool_executed" for event in completed.events)


def test_duplicate_approval_is_rejected():
    response = run_incident(IncidentRunRequest(scenario="clean_recovery", client="client_b"))
    decision = ApprovalDecisionRequest(decision="approve", approver_id="demo-operator")
    decide_approval(response.incident_id, decision)
    try:
        decide_approval(response.incident_id, decision)
    except ValueError as exc:
        assert "already reached a final outcome" in str(exc)
    else:
        raise AssertionError("Expected duplicate approval to be rejected")


def test_api_exposes_approval_workflow():
    client = TestClient(app)
    opened = client.post("/incidents", json={"scenario": "clean_recovery", "client": "client_b", "mode": "proofloop"})
    assert opened.status_code == 200
    body = opened.json()
    assert body["outcome"] == "PENDING_APPROVAL"
    incident_id = body["incident_id"]

    approved = client.post(
        f"/incidents/{incident_id}/approval",
        json={"decision": "approve", "approver_id": "demo-operator", "comment": "Approved in API test"},
    )
    assert approved.status_code == 200
    assert approved.json()["outcome"] == "VERIFIED"
