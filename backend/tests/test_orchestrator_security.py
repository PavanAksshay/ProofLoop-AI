"""Security-focused integration tests for the incident orchestrator."""

from app import orchestrator
from app.models import IncidentRunRequest, Outcome, ToolRequest
from app.simulator import ServiceSimulator


def _stub_persistence(monkeypatch):
    """Keep integration tests isolated from the developer's SQLite database."""
    monkeypatch.setattr(orchestrator, "incident_exists", lambda incident_id: False)
    monkeypatch.setattr(orchestrator, "create_incident", lambda *args, **kwargs: None)
    monkeypatch.setattr(orchestrator, "append_event", lambda event: None)
    monkeypatch.setattr(orchestrator, "update_incident_mode", lambda *args, **kwargs: None)
    monkeypatch.setattr(orchestrator, "save_pending_approval", lambda *args, **kwargs: None)


def test_blocked_action_never_reaches_simulator_execution(monkeypatch):
    _stub_persistence(monkeypatch)
    action = ToolRequest(
        tool="delete_production_database",
        service="checkout-service",
        arguments={},
    )
    monkeypatch.setattr(
        orchestrator,
        "propose_action",
        lambda simulator: (action, "Attempt an unapproved destructive action.", [], "llm:groq"),
    )

    def fail_if_executed(self, request):
        raise AssertionError("A policy-blocked action reached simulator.execute()")

    monkeypatch.setattr(ServiceSimulator, "execute", fail_if_executed)
    incident_id = "test-blocked-action-no-execution"

    response = orchestrator.run_incident(
        IncidentRunRequest(scenario="clean_recovery", client="client_a"),
        incident_id=incident_id,
    )

    assert response.outcome == Outcome.BLOCKED
    assert any(
        event.type == "policy_decision" and event.payload.get("decision") == "BLOCKED"
        for event in response.events
    )
    assert not any(event.type == "tool_executed" for event in response.events)
    orchestrator._completed_incidents.pop(incident_id, None)


def test_approval_required_action_waits_without_execution(monkeypatch):
    _stub_persistence(monkeypatch)
    action = ToolRequest(
        tool="modify_database",
        service="checkout-service",
        arguments={"operation": "repair"},
    )
    monkeypatch.setattr(
        orchestrator,
        "propose_action",
        lambda simulator: (action, "Database changes need human review.", [], "llm:groq"),
    )

    def fail_if_executed(self, request):
        raise AssertionError("An action was executed before human approval")

    monkeypatch.setattr(ServiceSimulator, "execute", fail_if_executed)
    incident_id = "test-approval-required-no-execution"
    orchestrator._pending_approvals.pop(incident_id, None)

    response = orchestrator.run_incident(
        IncidentRunRequest(scenario="clean_recovery", client="client_a"),
        incident_id=incident_id,
    )

    assert response.outcome == Outcome.PENDING_APPROVAL
    assert "No action has been executed" in response.summary
    assert any(event.type == "approval_requested" for event in response.events)
    assert not any(event.type == "tool_executed" for event in response.events)

    orchestrator._pending_approvals.pop(incident_id, None)
    orchestrator._completed_incidents.pop(incident_id, None)
