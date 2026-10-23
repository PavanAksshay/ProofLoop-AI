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

    @field_validator("approver_id")
    @classmethod
    def validate_approver_id(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("approver_id cannot be blank or whitespace only")
        return cleaned


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


class EvidenceKind(str, Enum):
    DIRECT_OBSERVATION = "direct_observation"
    DERIVED_MEASUREMENT = "derived_measurement"
    DIAGNOSTIC_RESULT = "diagnostic_result"
    INFERENCE = "inference"
    CONTRADICTORY = "contradictory"


class EvidenceItem(BaseModel):
    id: str = Field(default_factory=lambda: f"ev_{uuid4().hex[:8]}")
    source: str
    kind: EvidenceKind
    summary: str
    data: dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=utc_now)


class HypothesisStatus(str, Enum):
    ACTIVE = "active"
    CONFIRMED = "confirmed"
    REFUTED = "refuted"
    INCONCLUSIVE = "inconclusive"


class Hypothesis(BaseModel):
    id: str
    title: str
    description: str
    category: str = "general"
    confidence_score: float = Field(default=0.5, ge=0.0, le=1.0)
    supporting_evidence_ids: list[str] = Field(default_factory=list)
    contradicting_evidence_ids: list[str] = Field(default_factory=list)
    status: HypothesisStatus = HypothesisStatus.ACTIVE
    required_evidence: list[str] = Field(default_factory=list)
    applicable_diagnostics: list[str] = Field(default_factory=list)
    last_ranking_change_reason: str | None = None
    uncertainty_notes: str | None = None
    suggested_diagnostic: str | None = None
    suggested_remediation: ToolRequest | None = None


class DiagnosticProposal(BaseModel):
    tool: str
    service: str = "checkout-service"
    arguments: dict[str, Any] = Field(default_factory=dict)
    rationale: str
    target_hypotheses: list[str] = Field(default_factory=list)
    expected_information_value: float = Field(default=0.5, ge=0.0, le=1.0)
    distinguishing_power: str = ""


class DiagnosticResult(BaseModel):
    tool: str
    service: str = "checkout-service"
    arguments: dict[str, Any] = Field(default_factory=dict)
    success: bool
    data: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
    timestamp: datetime = Field(default_factory=utc_now)


class DiagnosisUpdate(BaseModel):
    diagnosis: str | None
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    confidence_basis: str
    leading_hypothesis_id: str | None = None
    unresolved_uncertainties: list[str] = Field(default_factory=list)


class RemediationRecord(BaseModel):
    id: str = Field(default_factory=lambda: f"rem_{uuid4().hex[:8]}")
    tool: str
    service: str = "checkout-service"
    arguments: dict[str, Any] = Field(default_factory=dict)
    attempt: int
    success: bool
    originating_hypothesis_id: str | None = None
    supporting_evidence_ids: list[str] = Field(default_factory=list)
    policy_decision: str | None = None
    policy_rule_id: str | None = None
    approver_id: str | None = None
    execution_result: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
    resulting_observations: dict[str, Any] = Field(default_factory=dict)
    verification_passed: bool | None = None
    verification_checks: list[dict[str, Any]] = Field(default_factory=list)
    replanning_reason: str | None = None
    timestamp: datetime = Field(default_factory=utc_now)


class InvestigationBudget(BaseModel):
    max_steps: int = 8
    max_diagnostics: int = 5
    max_remediations: int = 3
    steps_taken: int = 0
    diagnostics_run: int = 0
    remediations_attempted: int = 0
    remediations_proposed: int = 0
    remediations_blocked: int = 0
    remediations_pending_approval: int = 0


class InvestigationState(BaseModel):
    incident_id: str
    symptoms: list[str] = Field(default_factory=list)
    step: int = 0
    hypotheses: list[Hypothesis] = Field(default_factory=list)
    evidence: list[EvidenceItem] = Field(default_factory=list)
    diagnostics_performed: list[DiagnosticResult] = Field(default_factory=list)
    outstanding_uncertainties: list[str] = Field(default_factory=list)
    current_diagnosis: DiagnosisUpdate | None = None
    proposed_next_step: DiagnosticProposal | ToolRequest | None = None
    remediation_history: list[RemediationRecord] = Field(default_factory=list)
    budget: InvestigationBudget = Field(default_factory=InvestigationBudget)
    termination_reason: str | None = None
    replanning_cycle: int = 0
    last_evaluation_summary: str | None = None
    escalation_reason: str | None = None


class IncidentResponse(BaseModel):
    incident_id: str
    scenario: str
    client: str
    outcome: Outcome
    summary: str
    mode: str
    events: list[Event]
    investigation_state: InvestigationState | None = None


class BenchmarkRunRequest(BaseModel):
    scenarios: list[str] = Field(
        default_factory=lambda: [
            "clean_recovery",
            "false_green",
            "stale_runbook",
            "hostile_log",
            "first_fix_fails",
            "partial_recovery",
            "misleading_health_signal",
            "unprovable_recovery",
        ]
    )
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

