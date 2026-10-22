"""API contract tests for incident and approval endpoints.

These tests isolate HTTP behavior from the developer's local SQLite database and
external LLM providers. Execution-policy behavior is covered by orchestrator tests.
"""
from fastapi.testclient import TestClient

from app import main
from app.models import (
    Actor,
    ApprovalDecisionRequest,
    Event,
    IncidentResponse,
    Outcome,
)


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
