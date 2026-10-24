"""Cloud-OpsBench dataset adapter normalizing raw records into typed IncidentCases."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from benchmark.dataset_schema import (
    AgentIncidentInput,
    EvaluatorGroundTruth,
    NormalizedIncidentCase,
)

logger = logging.getLogger(__name__)


def derive_symptoms(query: str, tool_cache: dict[str, Any]) -> list[str]:
    """Extract discrete symptom statements from query and initial telemetry."""
    symptoms = [query.strip()] if query and query.strip() else []
    query_lower = query.lower()

    if "latency" in query_lower or "timeout" in query_lower:
        symptoms.append("Degraded service latency / request timeout observed")
    if "500" in query_lower or "error" in query_lower:
        symptoms.append("Elevated HTTP 5xx error rate reported by upstream callers")
    if "unreachability" in query_lower or "connection" in query_lower:
        symptoms.append("Service unreachability or transport connection refusal")
    if "deploy" in query_lower or "scheduling" in query_lower or "replica" in query_lower:
        symptoms.append("Workload deployment or pod scheduling failure")

    # Inspect initial pod status if present in tool cache
    for cmd, output in tool_cache.items():
        if "GetResources" in cmd and isinstance(output, str):
            for line in output.splitlines():
                if any(err in line for err in ("CreateContainerConfigError", "CrashLoopBackOff", "Pending", "FailedScheduling")):
                    parts = line.split()
                    if len(parts) >= 3:
                        symptoms.append(f"Pod {parts[0]} in abnormal status: {parts[2]}")

    # Remove duplicates preserving order
    seen = set()
    deduped = []
    for s in symptoms:
        if s not in seen:
            seen.add(s)
            deduped.append(s)
    return deduped


class CloudOpsBenchAdapter:
    """Adapter for Cloud-OpsBench datasets supporting fixtures and raw filesystem distributions."""

    @staticmethod
    def parse_record(raw: dict[str, Any], dataset_name: str = "Cloud-OpsBench", version: str = "v1.0.0") -> NormalizedIncidentCase:
        """Parse and normalize a single raw incident record.
        
        Gracefully marks incomplete/malformed records as unsupported with an explicit reason.
        """
        warnings: list[str] = []
        case_key = raw.get("case_key") or ""
        case_id_raw = str(raw.get("case_id") or "")

        # Validate minimum structural requirements
        if not case_key and not case_id_raw:
            return NormalizedIncidentCase(
                case_id="unknown_case",
                case_key="unknown",
                dataset_name=dataset_name,
                dataset_version=version,
                is_supported=False,
                exclusion_reason="MALFORMED_RECORD: Missing case_key and case_id",
                data_quality_warnings=["Record lacks stable identifiers"],
                agent_input=AgentIncidentInput(
                    case_id="unknown_case",
                    dataset_name=dataset_name,
                    dataset_version=version,
                    system="unknown",
                    namespace="unknown",
                    query="No query provided",
                ),
                ground_truth=EvaluatorGroundTruth(
                    case_id="unknown_case",
                    root_cause="unknown",
                    fault_object="unknown",
                    fault_taxonomy="unknown",
                ),
            )

        # Deterministic stable case ID
        stable_id = f"cloud_opsbench:{case_key}" if case_key else f"cloud_opsbench:case_{case_id_raw}"

        # Check required fields
        system = raw.get("system") or ""
        category = raw.get("category") or ""
        namespace = raw.get("namespace") or (system if system else "default")
        query = raw.get("query") or ""

        # Ground truth resolution: can be top-level or nested under 'result' (as in metadata.json)
        result_block = raw.get("result", {})
        root_cause = raw.get("root_cause") or result_block.get("root_cause") or ""
        fault_object = raw.get("fault_object") or result_block.get("fault_object") or ""
        fault_taxonomy = raw.get("fault_taxonomy") or result_block.get("fault_taxonomy") or category or "General_Fault"
        valid_alternatives = raw.get("valid_alternative_labels") or []
        difficulty = raw.get("difficulty") or "medium"

        # Check for missing required fields
        missing_fields = []
        if not system:
            missing_fields.append("system")
        if not query:
            missing_fields.append("query")
        if not root_cause:
            missing_fields.append("root_cause")
        if not fault_object:
            missing_fields.append("fault_object")

        if missing_fields:
            return NormalizedIncidentCase(
                case_id=stable_id,
                case_key=case_key or stable_id,
                dataset_name=dataset_name,
                dataset_version=version,
                is_supported=False,
                exclusion_reason=f"MALFORMED_RECORD: Missing required fields: {', '.join(missing_fields)}",
                data_quality_warnings=[f"Missing required fields: {missing_fields}"],
                agent_input=AgentIncidentInput(
                    case_id=stable_id,
                    dataset_name=dataset_name,
                    dataset_version=version,
                    system=system or "unknown",
                    namespace=namespace,
                    query=query or "Missing query",
                ),
                ground_truth=EvaluatorGroundTruth(
                    case_id=stable_id,
                    root_cause=root_cause or "unspecified",
                    fault_object=fault_object or "unspecified",
                    fault_taxonomy=fault_taxonomy,
                    difficulty=difficulty,
                ),
            )

        # Read-only tool cache
        tool_cache = raw.get("tool_cache", {})
        if not isinstance(tool_cache, dict):
            warnings.append("tool_cache was not a valid dictionary; defaulting to empty")
            tool_cache = {}

        # Available diagnostic tools based on tool cache keys
        available_tools = set()
        for k in tool_cache.keys():
            tool_name = k.split(":", 1)[0]
            available_tools.add(tool_name)

        symptoms = derive_symptoms(query, tool_cache)

        agent_input = AgentIncidentInput(
            case_id=stable_id,
            dataset_name=dataset_name,
            dataset_version=version,
            system=system,
            namespace=namespace,
            query=query,
            symptoms=symptoms,
            observations={
                "tool_cache_size": len(tool_cache),
                "recorded_commands": list(tool_cache.keys()),
            },
            available_diagnostic_tools=sorted(available_tools),
            tool_cache=tool_cache,
        )

        ground_truth = EvaluatorGroundTruth(
            case_id=stable_id,
            root_cause=root_cause,
            fault_object=fault_object,
            fault_taxonomy=fault_taxonomy,
            valid_alternative_labels=valid_alternatives,
            difficulty=difficulty,
            provenance=f"{dataset_name}:{version}",
        )

        return NormalizedIncidentCase(
            case_id=stable_id,
            case_key=case_key or stable_id,
            dataset_name=dataset_name,
            dataset_version=version,
            is_supported=True,
            data_quality_warnings=warnings,
            agent_input=agent_input,
            ground_truth=ground_truth,
        )

    @classmethod
    def load_fixture(cls, path: str | Path) -> list[NormalizedIncidentCase]:
        """Load cases from a standalone JSON fixture file."""
        file_path = Path(path).resolve()
        if not file_path.exists():
            raise FileNotFoundError(f"Fixture file not found: {file_path}")

        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        dataset_name = data.get("dataset_name", "Cloud-OpsBench")
        version = data.get("distribution_version", "v1.0.0")
        raw_cases = data.get("cases", [])

        cases = []
        for raw in raw_cases:
            case = cls.parse_record(raw, dataset_name=dataset_name, version=version)
            cases.append(case)
        return cases

    @classmethod
    def load_from_directory(cls, dir_path: str | Path, max_cases: int | None = None) -> list[NormalizedIncidentCase]:
        """Load cases from an official Cloud-OpsBench snapshot directory."""
        base_dir = Path(dir_path).resolve()
        index_file = base_dir / "index.jsonl"
        if not index_file.exists():
            raise FileNotFoundError(f"Cloud-OpsBench index.jsonl not found in {base_dir}")

        cases: list[NormalizedIncidentCase] = []
        with open(index_file, "r", encoding="utf-8") as f:
            for line_idx, line in enumerate(f, 1):
                if max_cases and len(cases) >= max_cases:
                    break
                stripped = line.strip()
                if not stripped:
                    continue
                try:
                    raw_row = json.loads(stripped)
                except Exception as exc:
                    cases.append(
                        NormalizedIncidentCase(
                            case_id=f"cloud_opsbench:malformed_line_{line_idx}",
                            case_key=f"malformed_line_{line_idx}",
                            dataset_name="Cloud-OpsBench",
                            dataset_version="v1.0.0",
                            is_supported=False,
                            exclusion_reason=f"MALFORMED_RECORD: JSON parse error on line {line_idx}: {exc}",
                            agent_input=AgentIncidentInput(
                                case_id=f"cloud_opsbench:malformed_line_{line_idx}",
                                system="unknown",
                                namespace="unknown",
                                query="Malformed line",
                            ),
                            ground_truth=EvaluatorGroundTruth(
                                case_id=f"cloud_opsbench:malformed_line_{line_idx}",
                                root_cause="unknown",
                                fault_object="unknown",
                                fault_taxonomy="unknown",
                            ),
                        )
                    )
                    continue

                # Optionally read tool_cache if present locally
                tool_cache_rel = raw_row.get("tool_cache_path")
                tool_cache = {}
                if tool_cache_rel:
                    tc_path = base_dir / tool_cache_rel
                    if tc_path.exists():
                        try:
                            with open(tc_path, "r", encoding="utf-8") as tcf:
                                tool_cache = json.load(tcf)
                        except Exception as e:
                            logger.warning("Failed to load tool_cache at %s: %s", tc_path, e)

                raw_row["tool_cache"] = tool_cache
                case = cls.parse_record(raw_row)
                cases.append(case)

        return cases
