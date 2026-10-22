from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Actor(str, Enum):
    AGENT = "agent"
    GATE = "gate"
    TOOL = "tool"
    VERIFIER = "verifier"
    HUMAN = "human"
    SYSTEM = "system"


class PolicyDecision(str, Enum):
    ALLOWED = "ALLOWED"
    APPROVAL_REQUIRED = "APPROVAL_REQUIRED"
    BLOCKED = "BLOCKED"


class Outcome(str, Enum):
    VERIFIED = "VERIFIED"
    UNVERIFIED = "UNVERIFIED"
    BLOCKED = "BLOCKED"
    ESCALATED = "ESCALATED"


class Event(BaseModel):
    event_id: str = Field(default_factory=lambda: str(uuid4()))
    incident_id: str
    timestamp: datetime = Field(default_factory=utc_now)
    type: str
    actor: Actor
    payload: dict[str, Any] = Field(default_factory=dict)
    evidence_refs: list[str] = Field(default_factory=list)


class IncidentRunRequest(BaseModel):
    scenario: str = "clean_recovery"
    client: str = "client_a"
    mode: str = "proofloop"


class ToolRequest(BaseModel):
    tool: str
    service: str = "checkout-service"
    arguments: dict[str, Any] = Field(default_factory=dict)


class PolicyResult(BaseModel):
    decision: PolicyDecision
    rule_id: str
    reason: str


class ToolResult(BaseModel):
    success: bool
    message: str
    result: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None


class VerificationCheck(BaseModel):
    check_name: str
    passed: bool
    observed: dict[str, Any] = Field(default_factory=dict)


class VerificationReport(BaseModel):
    all_passed: bool
    checks: list[VerificationCheck]


class IncidentResponse(BaseModel):
    incident_id: str
    scenario: str
    client: str
    outcome: Outcome
    summary: str
    mode: str
    events: list[Event]
