"""Benchmark runner executing read-only diagnosis evaluation on real-world datasets."""
from __future__ import annotations

import csv
import json
import logging
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from benchmark.dataset_adapter import CloudOpsBenchAdapter
from benchmark.dataset_baseline import run_diagnosis_baseline
from benchmark.dataset_diagnosis_engine import run_proofloop_diagnosis
from benchmark.dataset_evaluator import compute_dataset_metrics, evaluate_case
from benchmark.dataset_schema import EvaluationResult, NormalizedIncidentCase
from benchmark.runner import get_software_revision

logger = logging.getLogger(__name__)


def run_dataset_evaluation(
    cases: list[NormalizedIncidentCase] | None = None,
    fixture_path: str | Path | None = None,
    dataset_dir: str | Path | None = None,
    dataset_name: str = "Cloud-OpsBench",
    version: str = "v1.0.0",
    seed: int = 42,
    max_cases: int | None = None,
    run_id: str | None = None,
) -> dict[str, Any]:
    """Execute reproducible diagnosis evaluation comparing ProofLoop AI against the baseline.
    
    Guarantees:
    - Strict read-only diagnosis; no mutating actions or live infrastructure calls.
    - Zero evaluator ground-truth leakage to agent or baseline.
    - Deterministic execution with recorded random seed and software revision.
    - Explicit tracking of excluded or malformed records.
    """
    random.seed(seed)
    eval_id = run_id or f"dataset-eval-{uuid4().hex[:10]}"
    timestamp = datetime.now(timezone.utc).isoformat()
    software_rev = get_software_revision()

    # Load cases
    loaded_cases: list[NormalizedIncidentCase] = []
    if cases:
        loaded_cases = cases
    elif fixture_path:
        loaded_cases = CloudOpsBenchAdapter.load_fixture(fixture_path)
    elif dataset_dir:
        loaded_cases = CloudOpsBenchAdapter.load_from_directory(dataset_dir, max_cases=max_cases)
    else:
        # Default fallback to sample fixture
        default_fixture = Path(__file__).resolve().parent.parent / "datasets" / "fixtures" / "cloud_opsbench_sample.json"
        if default_fixture.exists():
            loaded_cases = CloudOpsBenchAdapter.load_fixture(default_fixture)
        else:
            raise ValueError("No cases, fixture, or directory provided for dataset evaluation.")

    if max_cases and len(loaded_cases) > max_cases:
        loaded_cases = loaded_cases[:max_cases]

    pl_results: list[EvaluationResult] = []
    baseline_results: list[EvaluationResult] = []
    excluded_cases: list[dict[str, Any]] = []
    failed_cases: list[dict[str, Any]] = []

    for case in loaded_cases:
        if not case.is_supported:
            excluded_cases.append({
                "case_id": case.case_id,
                "case_key": case.case_key,
                "reason": case.exclusion_reason or "Unsupported case format",
                "warnings": case.data_quality_warnings,
            })
            continue

        agent_input = case.get_agent_input()
        ground_truth = case.ground_truth

        # 1. Run ProofLoop Diagnosis
        try:
            pl_pred = run_proofloop_diagnosis(agent_input)
            pl_eval = evaluate_case(
                case_id=case.case_id,
                system=agent_input.system,
                dataset_name=case.dataset_name,
                prediction_result=pl_pred,
                ground_truth=ground_truth,
            )
            pl_results.append(pl_eval)
        except Exception as exc:
            logger.error("ProofLoop diagnosis failed on case %s: %s", case.case_id, exc)
            failed_cases.append({
                "case_id": case.case_id,
                "system": "ProofLoop AI",
                "error": str(exc),
            })

        # 2. Run Diagnosis Baseline
        try:
            base_pred = run_diagnosis_baseline(agent_input)
            base_eval = evaluate_case(
                case_id=case.case_id,
                system=agent_input.system,
                dataset_name=case.dataset_name,
                prediction_result=base_pred,
                ground_truth=ground_truth,
            )
            baseline_results.append(base_eval)
        except Exception as exc:
            logger.error("Baseline diagnosis failed on case %s: %s", case.case_id, exc)
            failed_cases.append({
                "case_id": case.case_id,
                "system": "Baseline",
                "error": str(exc),
            })

    # Compute aggregate comparative metrics
    pl_metrics = compute_dataset_metrics(pl_results, excluded_cases, failed_cases, "ProofLoop AI")
    baseline_metrics = compute_dataset_metrics(baseline_results, excluded_cases, failed_cases, "Heuristic Baseline")

    report: dict[str, Any] = {
        "run_id": eval_id,
        "timestamp": timestamp,
        "software_revision": software_rev,
        "dataset": {
            "name": dataset_name,
            "version": version,
            "total_cases_loaded": len(loaded_cases),
            "eligible_evaluated_cases": len(pl_results),
            "excluded_cases_count": len(excluded_cases),
            "failed_cases_count": len(failed_cases),
        },
        "parameters": {
            "seed": seed,
            "max_cases": max_cases,
            "fixture": str(fixture_path) if fixture_path else None,
            "directory": str(dataset_dir) if dataset_dir else None,
        },
        "metrics": {
            "proofloop": pl_metrics,
            "baseline": baseline_metrics,
        },
        "per_case_evaluation": [r.model_dump() for r in pl_results],
        "excluded_cases": excluded_cases,
        "failed_cases": failed_cases,
        "disclaimer": "All measurements reflect read-only operational diagnosis against pre-recorded state snapshots. No live systems were modified.",
    }

    return report


def export_report_csv(report: dict[str, Any], csv_path: str | Path) -> None:
    """Export per-case evaluation results to a clean CSV report."""
    path = Path(csv_path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)

    rows = report.get("per_case_evaluation", [])
    if not rows:
        return

    fieldnames = [
        "case_id", "system", "top1_prediction", "ground_truth_root_cause",
        "ground_truth_fault_object", "top1_match", "top3_match",
        "category_match", "confidence", "evidence_count", "elapsed_ms"
    ]

    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for r in rows:
            writer.writerow(r)
