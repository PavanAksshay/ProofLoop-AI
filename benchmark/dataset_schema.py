"""Normalized incident case schemas and strict ground-truth leakage isolation boundaries."""
from __future__ import annotations

from typing import Any
from pydantic import BaseModel, ConfigDict, Field, field_validator


class AgentIncidentInput(BaseModel):
    """The strictly isolated, sanitized payload provided to an investigating agent or baseline.
    
    HARD GOVERNANCE: Contains ONLY facts, symptoms, and read-only diagnostic telemetry.
    MUST NEVER contain root cause labels, fault objects, golden paths, or evaluator hints.
    """
    model_config = ConfigDict(extra="forbid")

    case_id: str = Field(description="Stable unique case identifier (e.g. cloud_opsbench:boutique/admission/1)")
    dataset_name: str = Field(default="Cloud-OpsBench")
    dataset_version: str = Field(default="v1.0.0")
    system: str = Field(description="Target microservice system (e.g. boutique, trainticket)")
    namespace: str = Field(description="Kubernetes namespace (e.g. boutique)")
    query: str = Field(description="Observed operator symptom description")
    symptoms: list[str] = Field(default_factory=list, description="Extracted symptom indicators")
    observations: dict[str, Any] = Field(default_factory=dict, description="Initial telemetry observations (logs/metrics)")
    available_diagnostic_tools: list[str] = Field(default_factory=list, description="Supported read-only tool names")
    tool_cache: dict[str, Any] = Field(default_factory=dict, description="Pre-recorded read-only tool responses")

    @field_validator("case_id")
    @classmethod
    def validate_case_id(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("case_id cannot be blank")
        return v.strip()

    def to_agent_payload(self) -> dict[str, Any]:
        """Serialize payload for consumption by diagnosis agents or LLM prompts.
        
        Guarantees that no ground truth keys are present in the resulting dictionary.
        """
        payload = {
            "case_id": self.case_id,
            "dataset_name": self.dataset_name,
            "dataset_version": self.dataset_version,
            "system": self.system,
            "namespace": self.namespace,
            "query": self.query,
            "symptoms": list(self.symptoms),
            "observations": dict(self.observations),
            "available_diagnostic_tools": list(self.available_diagnostic_tools),
        }
        # Invariant check: Assert no evaluator ground truth keys exist
        forbidden_keys = {
            "root_cause", "fault_object", "fault_taxonomy", "result",
            "milestone_path", "trajectory_paths", "golden_trajectory",
            "evaluator_notes", "valid_alternative_labels"
        }
        found_forbidden = forbidden_keys.intersection(payload.keys())
        if found_forbidden:
            raise RuntimeError(f"Evaluation Leakage Detected! Payload contains forbidden keys: {found_forbidden}")
        return payload


class EvaluatorGroundTruth(BaseModel):
    """Ground-truth information reserved exclusively for the independent evaluation harness.
    
    MUST NEVER be passed to an agent or baseline under evaluation.
    """
    model_config = ConfigDict(extra="forbid")

    case_id: str
    root_cause: str = Field(description="Ground-truth root cause identifier")
    fault_object: str = Field(description="Faulty Kubernetes component or microservice")
    fault_taxonomy: str = Field(description="Categorical fault classification")
    valid_alternative_labels: list[str] = Field(default_factory=list, description="Accepted synonym root cause labels")
    difficulty: str = Field(default="medium")
    provenance: str = Field(default="verified_distribution")
    evaluator_notes: str | None = None

    @field_validator("root_cause", "fault_object", "fault_taxonomy")
    @classmethod
    def validate_non_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Ground-truth fields cannot be empty")
        return v.strip()


class NormalizedIncidentCase(BaseModel):
    """Complete normalized case containing segregated agent input and evaluator ground truth."""
    model_config = ConfigDict(extra="forbid")

    case_id: str
    case_key: str
    dataset_name: str = "Cloud-OpsBench"
    dataset_version: str = "v1.0.0"
    is_supported: bool = True
    exclusion_reason: str | None = None
    data_quality_warnings: list[str] = Field(default_factory=list)
    agent_input: AgentIncidentInput
    ground_truth: EvaluatorGroundTruth

    def get_agent_input(self) -> AgentIncidentInput:
        """Return the strictly isolated agent-facing input, with no evaluator references."""
        return self.agent_input


class EvaluationResult(BaseModel):
    """Recorded diagnosis result for an individual evaluated case."""
    model_config = ConfigDict(extra="forbid")

    case_id: str
    dataset_name: str
    system: str
    status: str = "evaluated"  # "evaluated", "excluded", "failed"
    top1_prediction: str | None = None
    top3_predictions: list[str] = Field(default_factory=list)
    ground_truth_root_cause: str | None = None
    ground_truth_fault_object: str | None = None
    top1_match: bool = False
    top3_match: bool = False
    category_match: bool = False
    confidence: float = 0.0
    diagnostics_called: list[str] = Field(default_factory=list)
    evidence_count: int = 0
    elapsed_ms: float = 0.0
    exclusion_reason: str | None = None
    error: str | None = None
