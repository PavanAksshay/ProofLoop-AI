"""SQLite persistence for incident metadata and append-only event history."""
from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path
from typing import Any

from .models import Event, IncidentResponse, Outcome

DB_PATH = Path(os.environ.get("PROOFLOOP_DB_PATH", str(Path(__file__).resolve().parents[1] / "proofloop.db")))


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=10000")
    return conn


def initialize_store() -> None:
    with _connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS incidents (
                incident_id TEXT PRIMARY KEY,
                scenario TEXT NOT NULL,
                client TEXT NOT NULL,
                outcome TEXT NOT NULL,
                summary TEXT NOT NULL,
                mode TEXT NOT NULL DEFAULT 'fallback',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS incident_events (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT NOT NULL UNIQUE,
                incident_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                type TEXT NOT NULL,
                actor TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                evidence_refs_json TEXT NOT NULL,
                FOREIGN KEY (incident_id) REFERENCES incidents(incident_id)
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_events_incident_sequence ON incident_events(incident_id, sequence)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS pending_approvals (
                incident_id TEXT PRIMARY KEY,
                payload_json TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'resolved')),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (incident_id) REFERENCES incidents(incident_id)
            )
        """)


def create_incident(incident_id: str, scenario: str, client: str, outcome: Outcome = Outcome.RUNNING, summary: str = "Incident started.") -> None:
    initialize_store()
    with _connect() as conn:
        conn.execute(
            """INSERT INTO incidents (incident_id, scenario, client, outcome, summary, mode)
               VALUES (?, ?, ?, ?, ?, 'fallback')""",
            (incident_id, scenario, client, outcome.value, summary),
        )


def append_event(event: Event) -> int:
    initialize_store()
    payload = json.dumps(event.payload, separators=(",", ":"), default=str)
    refs = json.dumps(event.evidence_refs, separators=(",", ":"))
    with _connect() as conn:
        cursor = conn.execute(
            """INSERT OR IGNORE INTO incident_events
               (event_id, incident_id, timestamp, type, actor, payload_json, evidence_refs_json)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (event.event_id, event.incident_id, event.timestamp.isoformat(), event.type, event.actor.value, payload, refs),
        )
        row = conn.execute("SELECT sequence FROM incident_events WHERE event_id = ?", (event.event_id,)).fetchone()
        if event.type == "approval_requested":
            conn.execute(
                "UPDATE incidents SET outcome = ?, summary = ?, updated_at = CURRENT_TIMESTAMP WHERE incident_id = ?",
                (Outcome.PENDING_APPROVAL.value, "Waiting for an explicit human approval decision.", event.incident_id),
            )
        elif event.type == "outcome":
            outcome = str(event.payload.get("outcome", Outcome.UNVERIFIED.value))
            summary = str(event.payload.get("summary", "Incident completed."))
            conn.execute(
                "UPDATE incidents SET outcome = ?, summary = ?, updated_at = CURRENT_TIMESTAMP WHERE incident_id = ?",
                (outcome, summary, event.incident_id),
            )
        return int(row["sequence"])


def update_incident_status(incident_id: str, outcome: Outcome, summary: str) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE incidents SET outcome = ?, summary = ?, updated_at = CURRENT_TIMESTAMP WHERE incident_id = ?",
            (outcome.value, summary, incident_id),
        )


def get_incident_response(incident_id: str) -> IncidentResponse | None:
    initialize_store()
    with _connect() as conn:
        row = conn.execute("SELECT * FROM incidents WHERE incident_id = ?", (incident_id,)).fetchone()
        if row is None:
            return None
        event_rows = conn.execute(
            "SELECT * FROM incident_events WHERE incident_id = ? ORDER BY sequence",
            (incident_id,),
        ).fetchall()

    events = [
        Event(
            event_id=item["event_id"],
            incident_id=item["incident_id"],
            timestamp=item["timestamp"],
            type=item["type"],
            actor=item["actor"],
            payload=json.loads(item["payload_json"]),
            evidence_refs=json.loads(item["evidence_refs_json"]),
        )
        for item in event_rows
    ]
    return IncidentResponse(
        incident_id=row["incident_id"],
        scenario=row["scenario"],
        client=row["client"],
        outcome=row["outcome"],
        summary=row["summary"],
        mode=row["mode"],
        events=events,
    )


def list_incidents(limit: int = 50) -> list[dict[str, Any]]:
    initialize_store()
    safe_limit = max(1, min(limit, 200))
    with _connect() as conn:
        rows = conn.execute(
            "SELECT incident_id, scenario, client, outcome, summary, mode, created_at, updated_at FROM incidents ORDER BY created_at DESC LIMIT ?",
            (safe_limit,),
        ).fetchall()
    return [dict(row) for row in rows]


def events_after(incident_id: str, after_sequence: int = 0) -> list[dict[str, Any]]:
    initialize_store()
    with _connect() as conn:
        rows = conn.execute(
            """SELECT sequence, event_id, incident_id, timestamp, type, actor, payload_json, evidence_refs_json
               FROM incident_events WHERE incident_id = ? AND sequence > ? ORDER BY sequence""",
            (incident_id, after_sequence),
        ).fetchall()
    return [
        {
            "sequence": row["sequence"],
            "event_id": row["event_id"],
            "incident_id": row["incident_id"],
            "timestamp": row["timestamp"],
            "type": row["type"],
            "actor": row["actor"],
            "payload": json.loads(row["payload_json"]),
            "evidence_refs": json.loads(row["evidence_refs_json"]),
        }
        for row in rows
    ]


def incident_exists(incident_id: str) -> bool:
    initialize_store()
    with _connect() as conn:
        return conn.execute("SELECT 1 FROM incidents WHERE incident_id = ?", (incident_id,)).fetchone() is not None



def save_pending_approval(incident_id: str, payload: dict[str, Any]) -> None:
    """Persist the exact proposed action and simulator snapshot before waiting."""
    initialize_store()
    encoded = json.dumps(payload, separators=(",", ":"), default=str)
    with _connect() as conn:
        conn.execute(
            """INSERT INTO pending_approvals (incident_id, payload_json, status)
               VALUES (?, ?, 'pending')
               ON CONFLICT(incident_id) DO UPDATE SET
                   payload_json = excluded.payload_json,
                   status = 'pending',
                   updated_at = CURRENT_TIMESTAMP""",
            (incident_id, encoded),
        )


def get_pending_approval(incident_id: str) -> dict[str, Any] | None:
    initialize_store()
    with _connect() as conn:
        row = conn.execute(
            "SELECT payload_json, status FROM pending_approvals WHERE incident_id = ?",
            (incident_id,),
        ).fetchone()
    if row is None or row["status"] != "pending":
        return None
    payload = json.loads(row["payload_json"])
    payload["_status"] = row["status"]
    return payload


def claim_pending_approval(incident_id: str) -> dict[str, Any] | None:
    """Atomically claim a pending approval so only one concurrent decision wins."""
    initialize_store()
    with _connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT payload_json FROM pending_approvals WHERE incident_id = ? AND status = 'pending'",
            (incident_id,),
        ).fetchone()
        if row is None:
            conn.rollback()
            return None
        changed = conn.execute(
            """UPDATE pending_approvals SET status = 'processing', updated_at = CURRENT_TIMESTAMP
               WHERE incident_id = ? AND status = 'pending'""",
            (incident_id,),
        ).rowcount
        if changed != 1:
            conn.rollback()
            return None
        conn.commit()
    return json.loads(row["payload_json"])


def resolve_pending_approval(incident_id: str) -> None:
    initialize_store()
    with _connect() as conn:
        conn.execute(
            """UPDATE pending_approvals SET status = 'resolved', updated_at = CURRENT_TIMESTAMP
               WHERE incident_id = ? AND status IN ('pending', 'processing')""",
            (incident_id,),
        )


def release_pending_approval_claim(incident_id: str) -> None:
    initialize_store()
    with _connect() as conn:
        conn.execute(
            """UPDATE pending_approvals SET status = 'pending', updated_at = CURRENT_TIMESTAMP
               WHERE incident_id = ? AND status = 'processing'""",
            (incident_id,),
        )



def recover_interrupted_approval_claims() -> int:
    """Return interrupted claims to pending at process startup for this single-worker prototype."""
    initialize_store()
    with _connect() as conn:
        cursor = conn.execute(
            """UPDATE pending_approvals SET status = 'pending', updated_at = CURRENT_TIMESTAMP
               WHERE status = 'processing'"""
        )
        return int(cursor.rowcount)


def update_incident_mode(incident_id: str, mode: str) -> None:
    """Persist the investigator mode used for this incident."""
    initialize_store()
    with _connect() as conn:
        conn.execute(
            "UPDATE incidents SET mode = ?, updated_at = CURRENT_TIMESTAMP WHERE incident_id = ?",
            (mode, incident_id),
        )
