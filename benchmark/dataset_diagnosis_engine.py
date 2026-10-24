"""ProofLoop AI dataset diagnosis engine.

Performs read-only root-cause investigation on normalized AgentIncidentInput:
- Ingests visible symptoms and cached tool observations into typed EvidenceItems.
- Formulates and ranks competing Hypotheses based on corroborated telemetry.
- NEVER mutates infrastructure or executes remediation actions.
- Guarantees zero access to ground truth.
"""
from __future__ import annotations

import json
import time
from uuid import uuid4
from typing import Any

from app.investigation import generate_initial_hypotheses
from app.models import EvidenceItem, EvidenceKind, Hypothesis, HypothesisStatus
from benchmark.dataset_schema import AgentIncidentInput


def parse_observations_into_evidence(agent_input: AgentIncidentInput) -> list[EvidenceItem]:
    """Convert agent-visible symptoms and tool cache into structured EvidenceItems."""
    evidence: list[EvidenceItem] = []

    # 1. Symptom evidence
    for idx, s in enumerate(agent_input.symptoms):
        evidence.append(
            EvidenceItem(
                id=f"ev_sym_{idx}_{uuid4().hex[:6]}",
                source=f"symptom:{agent_input.system}",
                kind=EvidenceKind.DIRECT_OBSERVATION,
                summary=s,
                data={"query": agent_input.query, "namespace": agent_input.namespace},
            )
        )

    # 2. Tool cache observations
    for cmd, raw_output in agent_input.tool_cache.items():
        cmd_lower = cmd.lower()
        output_str = raw_output if isinstance(raw_output, str) else json.dumps(raw_output)

        if "log" in cmd_lower:
            kind = EvidenceKind.DIRECT_OBSERVATION
            summary = f"Log output from command {cmd.split(':', 1)[0]}"
        elif "metric" in cmd_lower:
            kind = EvidenceKind.DERIVED_MEASUREMENT
            summary = f"Metric telemetry from command {cmd.split(':', 1)[0]}"
        else:
            kind = EvidenceKind.DIRECT_OBSERVATION
            summary = f"Diagnostic inspection output from {cmd.split(':', 1)[0]}"

        # Truncate summary snippet
        first_line = output_str.strip().splitlines()[0] if output_str.strip() else "Empty output"
        if len(first_line) > 120:
            first_line = first_line[:117] + "..."

        evidence.append(
            EvidenceItem(
                id=f"ev_tool_{uuid4().hex[:6]}",
                source=f"tool:{cmd}",
                kind=kind,
                summary=f"{summary}: {first_line}",
                data={"command": cmd, "raw": raw_output},
            )
        )

    return evidence


def formulate_microservice_hypotheses(
    evidence: list[EvidenceItem],
    agent_input: AgentIncidentInput,
) -> list[Hypothesis]:
    """Formulate competing root-cause hypotheses tailored to observed microservice telemetry."""
    # Start with base hypotheses from standard investigation module
    base_hypotheses = generate_initial_hypotheses(agent_input.symptoms, evidence)
    hypotheses = list(base_hypotheses)

    # Inspect all evidence text to formulate domain-specific operational hypotheses
    corpus_items = []
    for ev in evidence:
        corpus_items.append((ev.id, ev.summary))
        raw_val = ev.data.get("raw")
        if isinstance(raw_val, str):
            corpus_items.append((ev.id, raw_val))
        elif isinstance(raw_val, dict):
            corpus_items.append((ev.id, json.dumps(raw_val)))

    # Pattern matchers for microservice failure modes
    matched_patterns: dict[str, dict[str, Any]] = {
        "missing_service_account": {
            "title": "Missing Kubernetes Service Account",
            "category": "admission",
            "keywords": ["serviceaccount", "service account", "failedmount", "createcontainerconfigerror"],
            "supporting_ev": [],
        },
        "cpu_limit_throttling": {
            "title": "CPU Quota Starvation and Throttling",
            "category": "performance",
            "keywords": ["throttl", "cpu_limit", "thread starvation", "cpu quota"],
            "supporting_ev": [],
        },
        "null_pointer_exception": {
            "title": "Application Code Defect / Null Reference",
            "category": "codedefect",
            "keywords": ["nullpointer", "cannot read properties", "typeerror", "exception in transaction"],
            "supporting_ev": [],
        },
        "connection_pool_exhausted": {
            "title": "Database Connection Pool Starvation",
            "category": "runtime",
            "keywords": ["connection is not available", "hikaripool", "connection pool", "pool starvation"],
            "supporting_ev": [],
        },
        "insufficient_memory": {
            "title": "Kubernetes Scheduling Failure (Insufficient Node Memory)",
            "category": "scheduling",
            "keywords": ["insufficient memory", "failedscheduling", "0/3 nodes are available"],
            "supporting_ev": [],
        },
        "network_partition_timeout": {
            "title": "Downstream Service Network Timeout",
            "category": "service",
            "keywords": ["connection refused", "context deadline exceeded", "transport error"],
            "supporting_ev": [],
        },
    }

    for ev_id, text in corpus_items:
        text_lower = text.lower()
        for key, p_data in matched_patterns.items():
            if any(kw in text_lower for kw in p_data["keywords"]):
                if ev_id not in p_data["supporting_ev"]:
                    p_data["supporting_ev"].append(ev_id)

    # Build Hypotheses from matched patterns
    for root_id, p_data in matched_patterns.items():
        ev_ids = p_data["supporting_ev"]
        if ev_ids:
            # Score confidence proportionally to corroborating evidence count
            confidence = min(0.95, 0.60 + (len(ev_ids) * 0.10))
            hypotheses.append(
                Hypothesis(
                    id=f"hyp_{root_id}_{uuid4().hex[:4]}",
                    title=p_data["title"],
                    description=f"Evidence correlates operational failure with {p_data['title'].lower()}.",
                    category=root_id,  # Use specific root-cause identifier as category
                    confidence_score=confidence,
                    supporting_evidence_ids=ev_ids,
                    status=HypothesisStatus.ACTIVE,
                    last_ranking_change_reason=f"Corroborated by {len(ev_ids)} telemetry observations",
                )
            )

    # Sort all hypotheses by confidence score descending
    hypotheses.sort(key=lambda h: h.confidence_score, reverse=True)
    return hypotheses


ROOT_TO_CATEGORY: dict[str, str] = {
    "missing_service_account": "admission",
    "cpu_limit_throttling": "performance",
    "null_pointer_exception": "codedefect",
    "connection_pool_exhausted": "runtime",
    "insufficient_memory": "scheduling",
    "network_partition_timeout": "service",
}


def run_proofloop_diagnosis(agent_input: AgentIncidentInput) -> dict[str, Any]:
    """Execute ProofLoop AI root-cause diagnosis on an AgentIncidentInput bundle.
    
    Guarantees:
    - 100% READ-ONLY execution.
    - Zero evaluator ground-truth access.
    - Full evidence-to-hypothesis traceability.
    """
    start_time = time.perf_counter()

    evidence = parse_observations_into_evidence(agent_input)
    hypotheses = formulate_microservice_hypotheses(evidence, agent_input)

    top_predictions = [h.category for h in hypotheses[:3]]
    leading_rc = top_predictions[0] if top_predictions else None
    leading_category = ROOT_TO_CATEGORY.get(leading_rc, "general")
    leading_confidence = hypotheses[0].confidence_score if hypotheses else 0.0
    elapsed_ms = (time.perf_counter() - start_time) * 1000.0

    return {
        "top1_prediction": leading_rc,
        "top1_category": leading_category,
        "top3_predictions": top_predictions,
        "confidence": leading_confidence,
        "hypotheses": [h.model_dump() for h in hypotheses],
        "diagnostics_called": list(agent_input.tool_cache.keys()),
        "evidence_count": len(evidence),
        "elapsed_ms": round(elapsed_ms, 2),
        "method": "proofloop_evidence_driven_hypotheses",
    }
