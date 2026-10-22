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
