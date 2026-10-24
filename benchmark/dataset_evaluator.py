"""Independent evaluation metrics and scoring for real-world dataset diagnosis."""
from __future__ import annotations

from typing import Any
from benchmark.dataset_schema import EvaluatorGroundTruth, EvaluationResult


def normalize_label(label: str | None) -> str:
    """Normalize identifier for robust, honest comparison."""
    if not label:
        return ""
    cleaned = label.strip().lower()
    # Strip common kubernetes resource prefix (e.g. app/adservice -> adservice)
    if cleaned.startswith("app/"):
        cleaned = cleaned[4:]
    # Normalize separators
    return cleaned.replace("-", "_").replace(" ", "_")


def is_label_match(prediction: str | None, ground_truth: EvaluatorGroundTruth) -> bool:
    """Determine whether a predicted diagnosis matches the ground-truth root cause or component."""
    if not prediction:
        return False

    norm_pred = normalize_label(prediction)
    norm_rc = normalize_label(ground_truth.root_cause)
    norm_obj = normalize_label(ground_truth.fault_object)
    norm_alternatives = [normalize_label(alt) for alt in ground_truth.valid_alternative_labels]

    # 1. Exact match against root cause
    if norm_pred == norm_rc:
        return True

    # 2. Exact match against faulty object / component
    if norm_pred == norm_obj:
        return True

    # 3. Match against accepted alternative labels
    if norm_pred in norm_alternatives:
        return True

    # 4. Component embedded match (e.g. adservice_admission_failure matches adservice)
    if norm_rc and (norm_pred.startswith(norm_rc) or norm_rc.startswith(norm_pred)):
        # Require substantial prefix length to prevent trivial substring matches
        if len(norm_rc) >= 6 and len(norm_pred) >= 6:
            return True

    return False


def is_category_match(
    predicted_category: str | None,
    ground_truth: EvaluatorGroundTruth,
    prediction: str | None = None,
) -> bool:
    """Check if predicted category or prediction matches the general fault taxonomy."""
    norm_tax = normalize_label(ground_truth.fault_taxonomy)
    if predicted_category:
        norm_cat = normalize_label(predicted_category)
        if norm_cat == norm_tax or norm_cat in norm_tax or norm_tax in norm_cat:
            return True
    if prediction:
        norm_pred = normalize_label(prediction)
        if norm_pred == norm_tax or norm_pred in norm_tax or norm_tax in norm_pred:
            return True
    return False


def evaluate_case(
    case_id: str,
    system: str,
    dataset_name: str,
    prediction_result: dict[str, Any],
    ground_truth: EvaluatorGroundTruth,
) -> EvaluationResult:
    """Evaluate a single case's diagnosis predictions against evaluator ground truth."""
    top1 = prediction_result.get("top1_prediction")
    top3 = prediction_result.get("top3_predictions", [])
    top1_cat = prediction_result.get("top1_category")

    top1_match = is_label_match(top1, ground_truth)
    top3_match = any(is_label_match(p, ground_truth) for p in top3)
    category_match = is_category_match(top1_cat, ground_truth, prediction=top1)

    return EvaluationResult(
        case_id=case_id,
        dataset_name=dataset_name,
        system=system,
        status="evaluated",
        top1_prediction=top1,
        top3_predictions=top3,
        ground_truth_root_cause=ground_truth.root_cause,
        ground_truth_fault_object=ground_truth.fault_object,
        top1_match=top1_match,
        top3_match=top3_match,
        category_match=category_match,
        confidence=prediction_result.get("confidence", 0.0),
        diagnostics_called=prediction_result.get("diagnostics_called", []),
        evidence_count=prediction_result.get("evidence_count", 0),
        elapsed_ms=prediction_result.get("elapsed_ms", 0.0),
    )


def compute_dataset_metrics(
    evaluated_results: list[EvaluationResult],
    excluded_cases: list[dict[str, Any]],
    failed_cases: list[dict[str, Any]],
    system_name: str = "ProofLoop AI",
) -> dict[str, Any]:
    """Compute aggregate diagnosis evaluation metrics with strict zero-denominator handling."""
    n_evaluated = len(evaluated_results)
    n_excluded = len(excluded_cases)
    n_failed = len(failed_cases)
    n_total = n_evaluated + n_excluded + n_failed

    if n_evaluated == 0:
        return {
            "system": system_name,
            "case_counts": {
                "total": n_total,
                "evaluated": 0,
                "excluded": n_excluded,
                "failed": n_failed,
            },
            "top1_accuracy": {
                "value": 0.0,
                "numerator": 0,
                "denominator": 0,
                "formula": "0 / 0 (no cases evaluated)",
                "is_defined": False,
                "status": "not_applicable",
            },
            "top3_accuracy": {
                "value": 0.0,
                "numerator": 0,
                "denominator": 0,
                "formula": "0 / 0 (no cases evaluated)",
                "is_defined": False,
                "status": "not_applicable",
            },
            "category_accuracy": {
                "value": 0.0,
                "numerator": 0,
                "denominator": 0,
                "formula": "0 / 0 (no cases evaluated)",
                "is_defined": False,
                "status": "not_applicable",
            },
            "avg_diagnostics_per_case": 0.0,
            "avg_elapsed_ms": 0.0,
            "evidence_traceability_rate": {
                "value": 0.0,
                "numerator": 0,
                "denominator": 0,
                "is_defined": False,
            },
        }

    # Top-1 Accuracy
    top1_correct = sum(1 for r in evaluated_results if r.top1_match)
    top1_pct = round((top1_correct / n_evaluated) * 100.0, 2)

    # Top-3 Accuracy
    top3_correct = sum(1 for r in evaluated_results if r.top3_match)
    top3_pct = round((top3_correct / n_evaluated) * 100.0, 2)

    # Category Accuracy
    category_correct = sum(1 for r in evaluated_results if r.category_match)
    cat_pct = round((category_correct / n_evaluated) * 100.0, 2)

    # Diagnostics & Timing
    total_diags = sum(len(r.diagnostics_called) for r in evaluated_results)
    avg_diags = round(total_diags / n_evaluated, 2)

    total_elapsed = sum(r.elapsed_ms for r in evaluated_results)
    avg_elapsed = round(total_elapsed / n_evaluated, 2)

    # Traceability
    traceable_count = sum(1 for r in evaluated_results if r.evidence_count > 0)
    traceability_pct = round((traceable_count / n_evaluated) * 100.0, 2)

    return {
        "system": system_name,
        "case_counts": {
            "total": n_total,
            "evaluated": n_evaluated,
            "excluded": n_excluded,
            "failed": n_failed,
        },
        "top1_accuracy": {
            "value": top1_pct,
            "numerator": top1_correct,
            "denominator": n_evaluated,
            "formula": f"{top1_correct} correct / {n_evaluated} evaluated cases",
            "is_defined": True,
            "status": "computed",
        },
        "top3_accuracy": {
            "value": top3_pct,
            "numerator": top3_correct,
            "denominator": n_evaluated,
            "formula": f"{top3_correct} correct in top 3 / {n_evaluated} evaluated cases",
            "is_defined": True,
            "status": "computed",
        },
        "category_accuracy": {
            "value": cat_pct,
            "numerator": category_correct,
            "denominator": n_evaluated,
            "formula": f"{category_correct} category matches / {n_evaluated} evaluated cases",
            "is_defined": True,
            "status": "computed",
        },
        "avg_diagnostics_per_case": avg_diags,
        "avg_elapsed_ms": avg_elapsed,
        "evidence_traceability_rate": {
            "value": traceability_pct,
            "numerator": traceable_count,
            "denominator": n_evaluated,
            "formula": f"{traceable_count} traceable / {n_evaluated} evaluated cases",
            "is_defined": True,
            "status": "computed",
        },
    }
