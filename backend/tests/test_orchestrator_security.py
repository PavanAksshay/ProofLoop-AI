"""Security-focused integration tests for the incident orchestrator."""

import pytest

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

@pytest.mark.parametrize(
    ("scenario", "expected_outcome"),
    [
        ("clean_recovery", Outcome.VERIFIED),
        ("false_green", Outcome.ESCALATED),
        ("stale_runbook", Outcome.VERIFIED),
        ("hostile_log", Outcome.VERIFIED),
    ],
)
def test_all_synthetic_scenarios_fail_safe_or_verify(monkeypatch, scenario, expected_outcome):
    _stub_persistence(monkeypatch)
    monkeypatch.setenv("PROOFLOOP_LLM_PROVIDER", "fallback")
    incident_id = f"scenario-contract-{scenario}"

    response = orchestrator.run_incident(
        IncidentRunRequest(scenario=scenario, client="client_a"),
        incident_id=incident_id,
    )

    assert response.outcome == expected_outcome
    assert any(event.type == "policy_decision" for event in response.events)
    if scenario == "false_green":
        assert response.outcome != Outcome.VERIFIED
        assert any(
            event.type == "verification_result"
            and event.payload.get("all_passed") is False
            for event in response.events
        )
    if scenario == "hostile_log":
        assert any(event.type == "injection_detected" for event in response.events)

    orchestrator._completed_incidents.pop(incident_id, None)


def test_investigation_limit_exhaustion_emits_event_and_escalates(monkeypatch):
    """Verify that exceeding MAX_INVESTIGATION_STEPS (8) halts execution and escalates."""
    _stub_persistence(monkeypatch)

    executed_tools = []
    original_execute = ServiceSimulator.execute

    def capture_execute(self, request):
        executed_tools.append(request.tool)
        return original_execute(self, request)

    monkeypatch.setattr(ServiceSimulator, "execute", capture_execute)

    # Propose read-only actions so action_attempts is not incremented
    read_action = ToolRequest(tool="read_config", service="checkout-service")
    monkeypatch.setattr(
        orchestrator,
        "propose_action",
        lambda sim: (read_action, "Investigating config", ["config:checkout-service"], "fallback"),
    )

    incident_id = "test-investigation-limit"
    response = orchestrator.run_incident(
        IncidentRunRequest(scenario="clean_recovery", client="client_a"),
        incident_id=incident_id,
    )

    assert response.outcome == Outcome.ESCALATED
    assert "Investigation step limit (8) reached" in response.summary
    assert any(
        event.type == "investigation_limit_reached"
        and event.payload.get("limit") == 8
        for event in response.events
    )

    # Step 1 was initial log evidence collection; 7 iterations took place (total 8 steps)
    # The 8th proposal executed tool 7 times, and step 8 halted before any 8th execution
    assert len(executed_tools) == 7
    orchestrator._completed_incidents.pop(incident_id, None)


def test_action_attempt_limit_independently_bounds_remediation(monkeypatch):
    """Verify that action_attempts limit (3) halts independently before investigation steps."""
    _stub_persistence(monkeypatch)

    executed_attempts = []
    original_execute = ServiceSimulator.execute

    def capture_execute(self, request):
        executed_attempts.append(request.tool)
        # Return failure so action attempts keep incrementing
        from app.models import ToolResult
        return ToolResult(success=False, message="Simulated failure", error="EXEC_FAIL")

    monkeypatch.setattr(ServiceSimulator, "execute", capture_execute)

    fail_action = ToolRequest(tool="clear_cache", service="checkout-service")
    monkeypatch.setattr(
        orchestrator,
        "propose_action",
        lambda sim: (fail_action, "Try clear cache", [], "fallback"),
    )

    incident_id = "test-action-attempt-limit"
    response = orchestrator.run_incident(
        IncidentRunRequest(scenario="clean_recovery", client="client_a"),
        incident_id=incident_id,
    )

    assert response.outcome == Outcome.ESCALATED
    assert len(executed_attempts) == 3
    # Investigation limit was not reached because action attempts stopped first
    assert not any(event.type == "investigation_limit_reached" for event in response.events)
    orchestrator._completed_incidents.pop(incident_id, None)

