"""SQLite persistence tests for pending approval claims and event history."""
from app import store
from app.models import Actor, Event, Outcome


def _initialize_test_store(monkeypatch, tmp_path):
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "proofloop-test.db")
    store.initialize_store()
    store.create_incident(
        "persisted-incident",
        "clean_recovery",
        "client_b",
        Outcome.PENDING_APPROVAL,
        "Waiting for approval.",
    )


def _approval_payload():
    return {
        "incident_id": "persisted-incident",
        "scenario": "clean_recovery",
        "client": "client_b",
        "simulator_snapshot": {
            "config_version": "v_bad",
            "healthy_config_version": "v_healthy",
            "replicas": 1,
            "process_running": True,
            "dependencies_healthy": True,
            "checkout_failures": 5,
            "error_rate": 0.8,
            "health_endpoint_status": 503,
            "simulated_minutes": 0,
            "logs": ["synthetic log"],
            "available_config_versions": ["v_bad", "v_healthy"],
        },
        "action": {
            "tool": "rollback_config",
            "service": "checkout-service",
            "arguments": {"target_version": "v_healthy"},
        },
        "attempt": 1,
        "rule_id": "POL-CLIENT-B-ROLLBACK",
        "reason": "Client B requires approval for configuration rollback.",
        "mode": "fallback",
    }


def test_pending_approval_claim_is_atomic_and_resolution_is_final(monkeypatch, tmp_path):
    _initialize_test_store(monkeypatch, tmp_path)
    payload = _approval_payload()
    store.save_pending_approval("persisted-incident", payload)

    first_claim = store.claim_pending_approval("persisted-incident")
    assert first_claim == payload
    assert store.claim_pending_approval("persisted-incident") is None

    store.release_pending_approval_claim("persisted-incident")
    pending = store.get_pending_approval("persisted-incident")
    assert pending is not None
    assert pending["_status"] == "pending"
    assert pending["action"] == payload["action"]

    assert store.claim_pending_approval("persisted-incident") == payload
    store.resolve_pending_approval("persisted-incident")
    assert store.get_pending_approval("persisted-incident") is None
    assert store.claim_pending_approval("persisted-incident") is None


def test_startup_recovers_interrupted_processing_claim(monkeypatch, tmp_path):
    _initialize_test_store(monkeypatch, tmp_path)
    store.save_pending_approval("persisted-incident", _approval_payload())
    assert store.claim_pending_approval("persisted-incident") is not None

    recovered = store.recover_interrupted_approval_claims()

    assert recovered == 1
    restored = store.get_pending_approval("persisted-incident")
    assert restored is not None
    assert restored["_status"] == "pending"
    assert store.claim_pending_approval("persisted-incident") is not None


def test_event_history_is_append_only_and_duplicate_event_ids_are_ignored(monkeypatch, tmp_path):
    _initialize_test_store(monkeypatch, tmp_path)
    event = Event(
        event_id="stable-event-id",
        incident_id="persisted-incident",
        type="approval_requested",
        actor=Actor.SYSTEM,
        payload={"tool": "rollback_config"},
        evidence_refs=["config:checkout-service"],
    )

    first_sequence = store.append_event(event)
    duplicate_sequence = store.append_event(event)
    rows = store.events_after("persisted-incident")

    assert first_sequence == duplicate_sequence
    assert len(rows) == 1
    assert rows[0]["event_id"] == "stable-event-id"
    assert rows[0]["type"] == "approval_requested"
    assert rows[0]["payload"] == {"tool": "rollback_config"}
    assert rows[0]["evidence_refs"] == ["config:checkout-service"]
