"""Heuristic diagnosis baseline for real-world dataset comparison.

Receives the identical sanitized AgentIncidentInput as ProofLoop AI.
Uses simple heuristic keyword matching without structured hypothesis reasoning.
"""
from __future__ import annotations

import time
from typing import Any

from benchmark.dataset_schema import AgentIncidentInput


def run_diagnosis_baseline(agent_input: AgentIncidentInput) -> dict[str, Any]:
    """Execute a simple rule-based heuristic diagnosis on agent-visible evidence.
    
    Guarantees:
    - Receives ZERO ground truth.
    - Operates purely on agent_input.query, agent_input.symptoms, and agent_input.tool_cache.
    - Produces ranked predictions and elapsed latency.
    """
    start_time = time.perf_counter()
    
    # Aggregate all visible text from query, symptoms, and tool cache
    visible_text_fragments = [agent_input.query] + list(agent_input.symptoms)
    for cmd, output in agent_input.tool_cache.items():
        visible_text_fragments.append(cmd)
        if isinstance(output, str):
            visible_text_fragments.append(output)
        elif isinstance(output, dict):
            visible_text_fragments.append(str(output))

    corpus = " ".join(visible_text_fragments).lower()

    # Heuristic detection rules
    candidates: list[tuple[str, float]] = []

    if "serviceaccount" in corpus or "service account" in corpus or "createcontainerconfigerror" in corpus:
        candidates.append(("missing_service_account", 0.70))
    if "throttl" in corpus or "cpu" in corpus and ("limit" in corpus or "quota" in corpus):
        candidates.append(("cpu_limit_throttling", 0.65))
    if "cannot read properties" in corpus or "nullpointer" in corpus or "typeerror" in corpus:
        candidates.append(("null_pointer_exception", 0.65))
    if "connection is not available" in corpus or "pool" in corpus and "exhaust" in corpus:
        candidates.append(("connection_pool_exhausted", 0.65))
    if "insufficient memory" in corpus or "failedscheduling" in corpus or "out of memory" in corpus:
        candidates.append(("insufficient_memory", 0.60))
    if "crashloopbackoff" in corpus:
        candidates.append(("crash_loop_backoff", 0.55))
    if "timeout" in corpus or "deadline exceeded" in corpus:
        candidates.append(("network_timeout", 0.50))
    if "500" in corpus or "error" in corpus:
        candidates.append(("internal_service_error", 0.45))

    # Fallback if no specific keyword triggered
    if not candidates:
        candidates.append(("unknown_transient_failure", 0.20))
        candidates.append(("configuration_defect", 0.15))
        candidates.append(("dependency_unavailable", 0.10))

    # Sort candidates by confidence score
    candidates.sort(key=lambda x: x[1], reverse=True)

    top_predictions = [c[0] for c in candidates[:3]]
    top1_pred = top_predictions[0] if top_predictions else None
    
    category_map = {
        "missing_service_account": "admission",
        "cpu_limit_throttling": "performance",
        "null_pointer_exception": "codedefect",
        "connection_pool_exhausted": "runtime",
        "insufficient_memory": "scheduling",
        "network_timeout": "service",
    }
    top1_cat = category_map.get(top1_pred, "general")
    leading_confidence = candidates[0][1] if candidates else 0.0
    elapsed_ms = (time.perf_counter() - start_time) * 1000.0

    return {
        "top1_prediction": top1_pred,
        "top1_category": top1_cat,
        "top3_predictions": top_predictions,
        "confidence": leading_confidence,
        "elapsed_ms": round(elapsed_ms, 2),
        "method": "heuristic_keyword_baseline",
    }
