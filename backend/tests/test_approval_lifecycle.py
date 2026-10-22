"""Lifecycle tests for human approval, persistence recovery, and duplicate decisions.

These tests stub persistence boundaries so they never read or mutate a developer's
local SQLite database. They exercise the real orchestrator decision flow.
"""
from copy import deepcopy

import pytest

from app import orchestrator
from app.models import (
    Actor,
    ApprovalDecisionRequest,
    Event,
    IncidentResponse,
    Outcome,
    ToolRequest,
)
from app.orchestrator import PendingApproval
from app.simulator import ServiceSimulator


def _payload(incident_id: str, action: ToolRequest, scenario: str = "clean_recovery", client: str = "client_b"):
    simulator = ServiceSimulator(scenario)
    return {
        "incident_id": incident_id,
        "scenario": scenario,
        "client": client,
        "simulator_snapshot": simulator.snapshot(),
        "action": action.model_dump(mode="json"),
        "attempt": 1,
        "rule_id": "POL-CLIENT-B-ROLLBACK",
        "reason": "Client B requires approval for configuration rollback.",
        "mode": "fallback",
    }


def _pending(incident_id: str, action: ToolRequest, scenario: str = "clean_recovery", client: str = "client_b"):
    simulator = ServiceSimulator(scenario)
    return PendingApproval(
        incident_id=incident_id,
        scenario=scenario,
        client=client,
        simulator=simulator,
        events=[
            Event(
                incident_id=incident_id,
                type="approval_requested",
                actor=Actor.SYSTEM,
                payload={"tool": action.tool, "service": action.service, "arguments": action.arguments},
            )
        ],
        action=action,
        attempt=1,
        rule_id="POL-CLIENT-B-ROLLBACK",
        reason="Client B requires approval for configuration rollback.",
        mode="fallback",
    )


@pytest.fixture(autouse=True)
def isolate_orchestrator(monkeypatch):
    monkeypatch.setattr(orchestrator, "append_event", lambda event: None)
    monkeypatch.setattr(orchestrator, "resolve_pending_approval", lambda incident_id: None)
    monkeypatch.setattr(orchestrator, "release_pending_approval_claim", lambda incident_id: None)
    monkeypatch.setattr(orchestrator, "get_pending_approval", lambda incident_id: None)
    monkeypatch.setattr(orchestrator, "get_incident_response", lambda incident_id: None)
    monkeypatch.setattr(orchestrator, "claim_pending_approval", lambda incident_id: None)
    yield
    orchestrator._pending_approvals.clear()
    orchestrator._completed_incidents.clear()


def _action():
    # Client B requires approval for this otherwise valid rollback.
    return ToolRequest(
        tool="rollback_config",
        service="checkout-service",
        arguments={"target_version": "v_healthy"},
    )


def test_deny_resolves_approval_without_executing_action(monkeypatch):
    incident_id = "approval-deny-no-execution"
    action = _action()
    pending = _pending(incident_id, action)
    orchestrator._pending_approvals[incident_id] = pending
    payload = _payload(incident_id, action)
    resolved = []
    executed = []

    monkeypatch.setattr(orchestrator, "claim_pending_approval", lambda _id: deepcopy(payload))
    monkeypatch.setattr(orchestrator, "resolve_pending_approval", lambda value: resolved.append(value))
    monkeypatch.setattr(
        ServiceSimulator,
        "execute",
        lambda self, request: executed.append(request) or pytest.fail("Denied action must never execute"),
    )

    response = orchestrator.decide_approval(
        incident_id,
        ApprovalDecisionRequest(decision="deny", approver_id="reviewer-1", comment="Not approved"),
    )

    assert response.outcome == Outcome.BLOCKED
    assert executed == []
    assert resolved == [incident_id]
    assert any(
        event.type == "human_approval_decision"
        and event.payload.get("decision") == "deny"
        for event in response.events
    )
    assert not any(event.type == "tool_executed" for event in response.events)


def test_approve_executes_saved_action_then_verifies_recovery(monkeypatch):
    incident_id = "approval-approve-executes-saved-action"
    action = _action()
    pending = _pending(incident_id, action)
    orchestrator._pending_approvals[incident_id] = pending
    payload = _payload(incident_id, action)
    executed = []
    resolved = []

    monkeypatch.setattr(orchestrator, "claim_pending_approval", lambda _id: deepcopy(payload))
    monkeypatch.setattr(orchestrator, "resolve_pending_approval", lambda value: resolved.append(value))
    original_execute = ServiceSimulator.execute

    def capture_execute(self, request):
        executed.append(request.model_dump(mode="json"))
        return original_execute(self, request)

    monkeypatch.setattr(ServiceSimulator, "execute", capture_execute)

    response = orchestrator.decide_approval(
        incident_id,
        ApprovalDecisionRequest(decision="approve", approver_id="reviewer-2"),
    )

    assert response.outcome == Outcome.VERIFIED
    assert executed == [action.model_dump(mode="json")]
    assert resolved == [incident_id]
    assert any(
        event.type == "human_approval_decision"
        and event.payload.get("decision") == "approve"
        for event in response.events
    )
    assert any(event.type == "tool_executed" for event in response.events)
    assert any(event.type == "verification_result" for event in response.events)


def test_duplicate_decision_after_resolution_is_rejected(monkeypatch):
    incident_id = "approval-duplicate-decision"
    action = _action()
    payload = _payload(incident_id, action)
    pending = _pending(incident_id, action)
    orchestrator._pending_approvals[incident_id] = pending
    monkeypatch.setattr(orchestrator, "claim_pending_approval", lambda _id: deepcopy(payload))

    first = orchestrator.decide_approval(
        incident_id,
        ApprovalDecisionRequest(decision="deny", approver_id="reviewer-1"),
    )
    assert first.outcome == Outcome.BLOCKED

    # Model the durable incident record after the API endpoint persisted the outcome.
    monkeypatch.setattr(orchestrator, "get_pending_approval", lambda _id: None)
    monkeypatch.setattr(orchestrator, "get_incident_response", lambda _id: first)
    monkeypatch.setattr(orchestrator, "claim_pending_approval", lambda _id: None)

    with pytest.raises(ValueError, match="final outcome"):
        orchestrator.decide_approval(
            incident_id,
            ApprovalDecisionRequest(decision="approve", approver_id="reviewer-2"),
        )


def test_pending_approval_can_be_rehydrated_after_process_memory_is_lost(monkeypatch):
    incident_id = "approval-rehydrate-after-restart"
    action = _action()
    payload = _payload(incident_id, action)
    prior_event = Event(
        incident_id=incident_id,
        type="approval_requested",
        actor=Actor.SYSTEM,
        payload={"tool": action.tool, "arguments": action.arguments},
    )
    stored_response = IncidentResponse(
        incident_id=incident_id,
        scenario="clean_recovery",
        client="client_b",
        outcome=Outcome.PENDING_APPROVAL,
        summary="Waiting for approval.",
        mode="fallback",
        events=[prior_event],
    )
    orchestrator._pending_approvals.pop(incident_id, None)
    monkeypatch.setattr(orchestrator, "get_pending_approval", lambda _id: deepcopy(payload))
    monkeypatch.setattr(orchestrator, "get_incident_response", lambda _id: stored_response)
    monkeypatch.setattr(orchestrator, "claim_pending_approval", lambda _id: deepcopy(payload))

    response = orchestrator.decide_approval(
        incident_id,
        ApprovalDecisionRequest(decision="approve", approver_id="reviewer-after-restart"),
    )

    assert response.outcome == Outcome.VERIFIED
    assert any(event.type == "tool_executed" for event in response.events)
    assert any(event.type == "verification_result" for event in response.events)


def test_unclaimed_concurrent_decision_never_executes_action(monkeypatch):
    incident_id = "approval-concurrent-claim-lost"
    action = _action()
    orchestrator._pending_approvals[incident_id] = _pending(incident_id, action)
    monkeypatch.setattr(orchestrator, "claim_pending_approval", lambda _id: None)
    monkeypatch.setattr(orchestrator, "get_incident_response", lambda _id: None)
    executed = []
    monkeypatch.setattr(
        ServiceSimulator,
        "execute",
        lambda self, request: executed.append(request) or pytest.fail("Unclaimed action must never execute"),
    )

    with pytest.raises(ValueError, match="already being processed|already been resolved"):
        orchestrator.decide_approval(
            incident_id,
            ApprovalDecisionRequest(decision="approve", approver_id="reviewer-race"),
        )

    assert executed == []

def test_policy_rejection_at_approval_time_is_final_and_never_executes(monkeypatch):
    incident_id = "approval-policy-tightened"
    action = ToolRequest(
        tool="rollback_config",
        service="checkout-service",
        arguments={"target_version": "v_bad"},
    )
    pending = _pending(incident_id, action)
    payload = _payload(incident_id, action)
    orchestrator._pending_approvals[incident_id] = pending
    resolved = []
    executed = []

    monkeypatch.setattr(orchestrator, "claim_pending_approval", lambda _id: deepcopy(payload))
    monkeypatch.setattr(orchestrator, "resolve_pending_approval", lambda value: resolved.append(value))
    monkeypatch.setattr(
        ServiceSimulator,
        "execute",
        lambda self, request: executed.append(request) or pytest.fail("Policy-rejected action must never execute"),
    )

    response = orchestrator.decide_approval(
        incident_id,
        ApprovalDecisionRequest(decision="approve", approver_id="reviewer-3"),
    )

    assert response.outcome == Outcome.BLOCKED
    assert executed == []
    assert resolved == [incident_id]
    assert any(event.type == "approval_rejected_by_policy" for event in response.events)
    assert any(
        event.type == "outcome" and event.payload.get("outcome") == Outcome.BLOCKED.value
        for event in response.events
    )

