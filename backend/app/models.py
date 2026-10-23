from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator


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
    PENDING_APPROVAL = "PENDING_APPROVAL"
    RUNNING = "RUNNING"


TERMINAL_OUTCOMES: set[Outcome] = {
    Outcome.VERIFIED,
    Outcome.UNVERIFIED,
    Outcome.BLOCKED,
    Outcome.ESCALATED,
}


class Event(BaseModel):
    event_id: str = Field(default_factory=lambda: str(uuid4()))
    incident_id: str
    timestamp: datetime = Field(default_factory=utc_now)
    type: str
    actor: Actor
    payload: dict[str, Any] = Field(default_factory=dict)
    evidence_refs: list[str] = Field(default_factory=list)


class CustomScenarioParams(BaseModel):
    custom_logs: list[str] = Field(default_factory=list)
    initial_error_rate: float = Field(default=0.8, ge=0.0, le=1.0)
    config_version: str = "v_bad"
    checkout_failures: int = 5
    health_endpoint_status: int = 503
    description: str = "User-defined custom incident."


class IncidentRunRequest(BaseModel):
    scenario: str = "clean_recovery"
    client: str = "client_a"
    mode: str = "proofloop"
    custom_params: CustomScenarioParams | None = None


class ApprovalDecisionRequest(BaseModel):
    decision: str
    approver_id: str = Field(min_length=1, max_length=100)
    comment: str = Field(default="", max_length=500)

    @field_validator("decision")
    @classmethod
    def validate_decision(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"approve", "deny"}:
            raise ValueError("decision must be 'approve' or 'deny'")
        return normalized


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


class BenchmarkRunRequest(BaseModel):
    scenarios: list[str] = Field(default_factory=lambda: ["clean_recovery", "false_green", "stale_runbook", "hostile_log"])
    client: str = Field(default="client_a", min_length=1, max_length=50)
    trials: int = Field(default=3, ge=1, le=20)
    seed: int = Field(default=42)

    @field_validator("scenarios")
    @classmethod
    def validate_scenarios(cls, values: list[str]) -> list[str]:
        if not values:
            raise ValueError("scenarios list cannot be empty")
        for s in values:
            if not isinstance(s, str) or not s.strip():
                raise ValueError("each scenario must be a non-empty string")
        return values

