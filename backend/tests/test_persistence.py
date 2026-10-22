import json
import sqlite3

from fastapi.testclient import TestClient

from app.main import app
from app.models import IncidentRunRequest
from app.orchestrator import run_incident
from app.store import DB_PATH, get_incident_response, list_incidents


def test_incident_events_persist_to_sqlite():
    response = run_incident(IncidentRunRequest(scenario="clean_recovery", client="client_a"))
    restored = get_incident_response(response.incident_id)
    assert restored is not None
    assert restored.outcome.value == "VERIFIED"
    assert [event.type for event in restored.events] == [event.type for event in response.events]


def test_incident_history_endpoint_lists_completed_incidents():
    response = run_incident(IncidentRunRequest(scenario="clean_recovery", client="client_a"))
    client = TestClient(app)
    result = client.get("/incidents")
    assert result.status_code == 200
    assert any(item["incident_id"] == response.incident_id for item in result.json()["incidents"])


def test_sse_endpoint_replays_persisted_events():
    response = run_incident(IncidentRunRequest(scenario="clean_recovery", client="client_a"))
    client = TestClient(app)
    stream = client.get(f"/incidents/{response.incident_id}/events")
    assert stream.status_code == 200
    assert "event: incident_opened" in stream.text
    assert "event: verification_result" in stream.text
    assert "event: outcome" in stream.text


def test_sse_supports_resume_cursor():
    response = run_incident(IncidentRunRequest(scenario="clean_recovery", client="client_a"))
    client = TestClient(app)
    with sqlite3.connect(DB_PATH) as conn:
        seq = conn.execute(
            "SELECT sequence FROM incident_events WHERE incident_id = ? ORDER BY sequence LIMIT 1",
            (response.incident_id,),
        ).fetchone()[0]
    stream = client.get(f"/incidents/{response.incident_id}/events?after={seq}")
    assert stream.status_code == 200
    assert "event: incident_opened" not in stream.text
    assert "event: outcome" in stream.text



def test_pending_approval_survives_orchestrator_memory_clear():
    from app.models import ApprovalDecisionRequest, Outcome
    from app.orchestrator import _pending_approvals, decide_approval

    opened = run_incident(IncidentRunRequest(scenario="clean_recovery", client="client_b"))
    assert opened.outcome == Outcome.PENDING_APPROVAL
    _pending_approvals.pop(opened.incident_id, None)  # Simulate a process restart.
    completed = decide_approval(
        opened.incident_id,
        ApprovalDecisionRequest(decision="approve", approver_id="restart-test"),
    )
    assert completed.outcome == Outcome.VERIFIED
    assert any(event.type == "human_approval_decision" for event in completed.events)
    assert any(
        event.type == "tool_executed" and event.payload.get("approved_by") == "restart-test"
        for event in completed.events
    )


def test_durable_denial_after_memory_clear_never_executes_action():
    from app.models import ApprovalDecisionRequest, Outcome
    from app.orchestrator import _pending_approvals, decide_approval

    opened = run_incident(IncidentRunRequest(scenario="clean_recovery", client="client_b"))
    _pending_approvals.pop(opened.incident_id, None)
    completed = decide_approval(
        opened.incident_id,
        ApprovalDecisionRequest(decision="deny", approver_id="restart-test", comment="Denied after restart"),
    )
    assert completed.outcome == Outcome.BLOCKED
    assert not any(event.type == "tool_executed" for event in completed.events)
    assert any(event.type == "human_approval_decision" for event in completed.events)


def test_second_durable_approval_decision_is_rejected():
    from app.models import ApprovalDecisionRequest
    from app.orchestrator import _pending_approvals, decide_approval

    opened = run_incident(IncidentRunRequest(scenario="clean_recovery", client="client_b"))
    _pending_approvals.pop(opened.incident_id, None)
    decision = ApprovalDecisionRequest(decision="approve", approver_id="restart-test")
    decide_approval(opened.incident_id, decision)
    try:
        decide_approval(opened.incident_id, decision)
    except ValueError as exc:
        assert "final outcome" in str(exc) or "already been resolved" in str(exc)
    else:
        raise AssertionError("Expected the second decision to be rejected")



def test_interrupted_approval_claim_is_recovered_on_startup():
    from app.models import ApprovalDecisionRequest, Outcome
    from app.orchestrator import _pending_approvals, decide_approval
    from app.store import claim_pending_approval, recover_interrupted_approval_claims

    opened = run_incident(IncidentRunRequest(scenario="clean_recovery", client="client_b"))
    _pending_approvals.pop(opened.incident_id, None)
    assert claim_pending_approval(opened.incident_id) is not None
    assert recover_interrupted_approval_claims() >= 1
    completed = decide_approval(
        opened.incident_id,
        ApprovalDecisionRequest(decision="approve", approver_id="recovery-test"),
    )
    assert completed.outcome == Outcome.VERIFIED
