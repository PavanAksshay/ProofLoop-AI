"""API contract tests for incident and approval endpoints.

These tests isolate HTTP behavior from the developer's local SQLite database and
external LLM providers. Execution-policy behavior is covered by orchestrator tests.
"""
import asyncio
import pytest
from fastapi.testclient import TestClient

from app import main, store
from app.models import (
    Actor,
    Event,
    IncidentResponse,
    Outcome,
)


@pytest.fixture(autouse=True)
def isolate_startup(monkeypatch):
    """Keep API contract tests from initializing or recovering the developer database."""
    monkeypatch.setattr(main, "initialize_store", lambda: None)
    monkeypatch.setattr(store, "recover_interrupted_approval_claims", lambda: None)


def _response(incident_id: str = "api-test-incident", outcome: Outcome = Outcome.VERIFIED):
    return IncidentResponse(
        incident_id=incident_id,
        scenario="clean_recovery",
        client="client_a",
        outcome=outcome,
        summary="Test response",
        mode="fallback",
        events=[
            Event(
                incident_id=incident_id,
                type="outcome",
                actor=Actor.SYSTEM,
                payload={"outcome": outcome.value},
            )
        ],
    )


def test_health_endpoint_reports_synthetic_prototype(monkeypatch):
    monkeypatch.setattr(main, "configured_mode", lambda: "fallback")

    with TestClient(main.app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "configured_mode": "fallback",
        "implementation": "synthetic-prototype",
    }


def test_scenarios_endpoint_exposes_supported_contract():
    with TestClient(main.app) as client:
        response = client.get("/scenarios")

    assert response.status_code == 200
    payload = response.json()
    assert payload["scenarios"]
    assert payload["clients"] == ["client_a", "client_b"]
    assert payload["modes"] == ["proofloop"]


def test_sync_incident_endpoint_returns_typed_incident_response(monkeypatch):
    captured = {}

    def fake_run(request):
        captured["scenario"] = request.scenario
        captured["client"] = request.client
        return _response()

    monkeypatch.setattr(main, "run_incident", fake_run)

    with TestClient(main.app) as client:
        response = client.post(
            "/incidents",
            json={"scenario": "clean_recovery", "client": "client_a", "mode": "proofloop"},
        )

    assert response.status_code == 200
    assert captured == {"scenario": "clean_recovery", "client": "client_a"}
    assert response.json()["incident_id"] == "api-test-incident"
    assert response.json()["outcome"] == "VERIFIED"
    assert response.json()["events"][0]["type"] == "outcome"


def test_sync_incident_endpoint_maps_invalid_scenario_to_422(monkeypatch):
    def reject_request(request):
        raise ValueError("Unsupported scenario: not-a-scenario")

    monkeypatch.setattr(main, "run_incident", reject_request)

    with TestClient(main.app) as client:
        response = client.post("/incidents", json={"scenario": "not-a-scenario"})

    assert response.status_code == 422
    assert "Unsupported scenario" in response.json()["detail"]


def test_start_endpoint_rejects_invalid_scenario_before_persisting(monkeypatch):
    persisted = []
    monkeypatch.setattr(main, "create_incident", lambda *args, **kwargs: persisted.append(args))

    with TestClient(main.app) as client:
        response = client.post("/incidents/start", json={"scenario": "not-a-scenario"})

    assert response.status_code == 422
    assert persisted == []


def test_unknown_incident_read_returns_404(monkeypatch):
    monkeypatch.setattr(main, "get_incident_response", lambda incident_id: None)
    monkeypatch.setattr(main, "get_incident", lambda incident_id: None)

    with TestClient(main.app) as client:
        response = client.get("/incidents/does-not-exist")

    assert response.status_code == 404
    assert response.json()["detail"] == "Incident not found."


def test_unknown_incident_event_stream_returns_404(monkeypatch):
    monkeypatch.setattr(main, "incident_exists", lambda incident_id: False)

    with TestClient(main.app) as client:
        response = client.get("/incidents/does-not-exist/events")

    assert response.status_code == 404
    assert response.json()["detail"] == "Incident not found."


def test_invalid_approval_decision_is_rejected_by_request_validation():
    with TestClient(main.app) as client:
        response = client.post(
            "/incidents/incident-1/approval",
            json={"decision": "maybe", "approver_id": "reviewer-1"},
        )

    assert response.status_code == 422


def test_approval_endpoint_maps_missing_pending_approval_to_404(monkeypatch):
    def missing_approval(incident_id, request):
        raise KeyError("No pending approval exists for this incident.")

    monkeypatch.setattr(main, "decide_approval", missing_approval)

    with TestClient(main.app) as client:
        response = client.post(
            "/incidents/unknown/approval",
            json={"decision": "deny", "approver_id": "reviewer-1"},
        )

    assert response.status_code == 404
    assert "No pending approval" in response.json()["detail"]


def test_incident_list_rejects_out_of_range_limit(monkeypatch):
    monkeypatch.setattr(main, "list_incidents", lambda limit: [])

    with TestClient(main.app) as client:
        response = client.get("/incidents?limit=0")

    assert response.status_code == 422

def test_approval_endpoint_persists_final_outcome_and_events(monkeypatch):
    response_model = _response(incident_id="incident-1", outcome=Outcome.BLOCKED)
    persisted_events = []
    persisted_status = []

    monkeypatch.setattr(main, "decide_approval", lambda incident_id, request: response_model)
    monkeypatch.setattr(store, "append_event", lambda event: persisted_events.append(event))
    monkeypatch.setattr(
        store,
        "update_incident_status",
        lambda incident_id, outcome, summary: persisted_status.append((incident_id, outcome, summary)),
    )

    with TestClient(main.app) as client:
        response = client.post(
            "/incidents/incident-1/approval",
            json={"decision": "deny", "approver_id": "reviewer-1"},
        )

    assert response.status_code == 200
    assert response.json()["outcome"] == "BLOCKED"
    assert len(persisted_events) == len(response_model.events)
    assert persisted_status == [
        ("incident-1", Outcome.BLOCKED, response_model.summary)
    ]


def test_cors_preflight_allows_configured_vite_origins():
    with TestClient(main.app) as client:
        # Test localhost origin
        response_localhost = client.options(
            "/incidents",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert response_localhost.status_code == 200
        assert response_localhost.headers["access-control-allow-origin"] == "http://localhost:5173"
        assert "POST" in response_localhost.headers["access-control-allow-methods"]

        # Test 127.0.0.1 origin
        response_ip = client.options(
            "/incidents",
            headers={
                "Origin": "http://127.0.0.1:5173",
                "Access-Control-Request-Method": "POST",
            },
        )
        assert response_ip.status_code == 200
        assert response_ip.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"


def test_cors_preflight_rejects_unauthorized_origins():
    with TestClient(main.app) as client:
        response = client.options(
            "/incidents",
            headers={
                "Origin": "http://malicious-external-site.com",
                "Access-Control-Request-Method": "POST",
            },
        )
        assert response.headers.get("access-control-allow-origin") != "http://malicious-external-site.com"


def test_cors_actual_request_includes_allow_origin_header():
    with TestClient(main.app) as client:
        response = client.get(
            "/scenarios",
            headers={"Origin": "http://localhost:5173"},
        )
        assert response.status_code == 200
        assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"


@pytest.mark.anyio
async def test_sse_stream_stays_open_on_pending_approval_and_completes_on_terminal_outcome(monkeypatch):
    """Ensure SSE stream does not terminate while in PENDING_APPROVAL and closes at terminal outcome."""
    events_db = [
        {
            "sequence": 1,
            "event_id": "event-1",
            "incident_id": "stream-test",
            "timestamp": "2026-10-23T10:00:00+00:00",
            "type": "approval_requested",
            "actor": "system",
            "payload": {"tool": "rollback_config"},
            "evidence_refs": [],
        }
    ]

    current_state = {"outcome": Outcome.PENDING_APPROVAL}
    poll_count = 0

    def fake_events_after(incident_id, after):
        return [row for row in events_db if row["sequence"] > after]

    def fake_get_incident(incident_id):
        nonlocal poll_count
        poll_count += 1
        # On the second check after delivering approval_requested, simulate that the approval resolved to VERIFIED
        if poll_count >= 2 and current_state["outcome"] == Outcome.PENDING_APPROVAL:
            events_db.append({
                "sequence": 2,
                "event_id": "event-2",
                "incident_id": "stream-test",
                "timestamp": "2026-10-23T10:00:01+00:00",
                "type": "outcome",
                "actor": "system",
                "payload": {"outcome": "VERIFIED"},
                "evidence_refs": [],
            })
            current_state["outcome"] = Outcome.VERIFIED
        return type("MockIncident", (), {"outcome": current_state["outcome"]})()

    monkeypatch.setattr(main, "incident_exists", lambda incident_id: True)
    monkeypatch.setattr(main, "events_after", fake_events_after)
    monkeypatch.setattr(main, "get_incident_response", fake_get_incident)
    original_sleep = asyncio.sleep
    monkeypatch.setattr(asyncio, "sleep", lambda _s: original_sleep(0.001))

    class MockRequest:
        async def is_disconnected(self):
            return False

    streaming_response = await main.stream_incident_events(MockRequest(), "stream-test", after=0)
    received = []
    async for chunk in streaming_response.body_iterator:
        received.append(chunk)

    full_output = "".join(received)
    assert "event: approval_requested" in full_output
    assert "event: outcome" in full_output
    assert "id: 1" in full_output
    assert "id: 2" in full_output

