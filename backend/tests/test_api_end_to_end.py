"""End-to-end API contract checks using the real orchestrator and isolated persistence."""

import json

import pytest
from fastapi.testclient import TestClient

from app import main, orchestrator
from app.models import Outcome


@pytest.fixture(autouse=True)
def isolate_runtime(monkeypatch):
    # The contract suite must never touch the developer's local SQLite file.
    monkeypatch.setattr(main, "initialize_store", lambda: None)
    monkeypatch.setattr(orchestrator, "incident_exists", lambda incident_id: False)
    monkeypatch.setattr(orchestrator, "create_incident", lambda *args, **kwargs: None)
    monkeypatch.setattr(orchestrator, "append_event", lambda event: None)
    monkeypatch.setattr(orchestrator, "update_incident_mode", lambda *args, **kwargs: None)
    monkeypatch.setattr(orchestrator, "save_pending_approval", lambda *args, **kwargs: None)
    monkeypatch.setattr(orchestrator, "get_pending_approval", lambda incident_id: None)
    monkeypatch.setattr(orchestrator, "claim_pending_approval", lambda incident_id: None)
    monkeypatch.setattr(orchestrator, "resolve_pending_approval", lambda incident_id: None)
    monkeypatch.setattr(orchestrator, "release_pending_approval_claim", lambda incident_id: None)
    monkeypatch.setattr(orchestrator, "get_incident_response", lambda incident_id: None)
    monkeypatch.setattr(main, "get_incident_response", lambda incident_id: None)
    monkeypatch.setattr(main, "incident_exists", lambda incident_id: False)
    monkeypatch.setattr(main, "events_after", lambda incident_id, after: [])
    monkeypatch.setattr(main, "create_incident", lambda *args, **kwargs: None)
    monkeypatch.setattr(main, "update_incident_status", lambda *args, **kwargs: None)
    monkeypatch.setenv("PROOFLOOP_LLM_PROVIDER", "fallback")
    orchestrator._pending_approvals.clear()
    orchestrator._completed_incidents.clear()
    yield
    orchestrator._pending_approvals.clear()
    orchestrator._completed_incidents.clear()


@pytest.mark.parametrize(
    ("scenario", "expected"),
    [
        ("clean_recovery", "VERIFIED"),
        ("false_green", "ESCALATED"),
        ("stale_runbook", "VERIFIED"),
        ("hostile_log", "VERIFIED"),
    ],
)
def test_real_sync_http_endpoint_runs_each_synthetic_scenario(scenario, expected):
    with TestClient(main.app) as client:
        response = client.post(
            "/incidents",
            json={"scenario": scenario, "client": "client_a", "mode": "proofloop"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["scenario"] == scenario
    assert body["outcome"] == expected
    event_types = [event["type"] for event in body["events"]]
    assert "policy_decision" in event_types
    assert "verification_result" in event_types
    if scenario == "false_green":
        result = next(event for event in body["events"] if event["type"] == "verification_result")
        assert result["payload"]["all_passed"] is False
        assert body["outcome"] != "VERIFIED"
    if scenario == "hostile_log":
        assert "injection_detected" in event_types


def test_sse_replays_events_after_numeric_cursor(monkeypatch):
    event_rows = [
        {
            "sequence": 4,
            "event_id": "event-4",
            "incident_id": "sse-incident",
            "timestamp": "2026-10-23T10:00:00+00:00",
            "type": "policy_decision",
            "actor": "gate",
            "payload": {"decision": "ALLOWED"},
            "evidence_refs": [],
        },
        {
            "sequence": 5,
            "event_id": "event-5",
            "incident_id": "sse-incident",
            "timestamp": "2026-10-23T10:00:01+00:00",
            "type": "outcome",
            "actor": "system",
            "payload": {"outcome": "VERIFIED", "summary": "Verified"},
            "evidence_refs": [],
        },
    ]
    monkeypatch.setattr(main, "incident_exists", lambda incident_id: True)
    monkeypatch.setattr(main, "events_after", lambda incident_id, after: [row for row in event_rows if row["sequence"] > after])
    monkeypatch.setattr(
        main,
        "get_incident_response",
        lambda incident_id: type("StoredIncident", (), {"outcome": Outcome.VERIFIED})(),
    )

    with TestClient(main.app) as client:
        response = client.get("/incidents/sse-incident/events?after=4")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "id: 5\nevent: outcome\ndata: " in response.text
    assert '"sequence":5' in response.text
    assert "id: 4\nevent: policy_decision" not in response.text
