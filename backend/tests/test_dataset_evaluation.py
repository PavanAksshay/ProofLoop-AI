"""Comprehensive tests for real-world dataset diagnosis evaluation, schema validation, and leakage prevention."""
from __future__ import annotations

import csv
import json
import tempfile
from pathlib import Path
import pytest
from pydantic import ValidationError

from benchmark.dataset_adapter import CloudOpsBenchAdapter
from benchmark.dataset_baseline import run_diagnosis_baseline
from benchmark.dataset_diagnosis_engine import run_proofloop_diagnosis
from benchmark.dataset_evaluator import (
    compute_dataset_metrics,
    evaluate_case,
    is_category_match,
    is_label_match,
)
from benchmark.dataset_runner import export_report_csv, run_dataset_evaluation
from benchmark.dataset_schema import (
    AgentIncidentInput,
    EvaluatorGroundTruth,
    NormalizedIncidentCase,
)
from benchmark.runner import run_benchmark


@pytest.fixture
def sample_valid_case() -> NormalizedIncidentCase:
    raw = {
        "case_key": "boutique/admission/1",
        "case_id": "1",
        "system": "boutique",
        "category": "admission",
        "namespace": "boutique",
        "difficulty": "medium",
        "query": "Partial Service Unreachability.",
        "fault_object": "app/adservice",
        "fault_taxonomy": "Admission_Fault",
        "root_cause": "missing_service_account",
        "valid_alternative_labels": ["service_account_not_found"],
        "tool_cache": {
            "GetResources:{\"resource_type\":\"pods\",\"namespace\":\"boutique\"}": "adservice-7b5f99c86-x7pl2 0/1 CreateContainerConfigError 0 2m\n",
            "DescribeResource:{\"resource_type\":\"pods\",\"name\":\"adservice\",\"namespace\":\"boutique\"}": "serviceaccount \"adservice\" not found\n",
        },
    }
    return CloudOpsBenchAdapter.parse_record(raw)


def test_adapter_parsing_valid_record(sample_valid_case: NormalizedIncidentCase):
    """Verify clean parsing, deterministic case ID, and separation of concerns."""
    assert sample_valid_case.is_supported is True
    assert sample_valid_case.case_id == "cloud_opsbench:boutique/admission/1"
    assert sample_valid_case.dataset_name == "Cloud-OpsBench"
    assert sample_valid_case.dataset_version == "v1.0.0"

    # Agent input verification
    agent_input = sample_valid_case.get_agent_input()
    assert agent_input.system == "boutique"
    assert agent_input.namespace == "boutique"
    assert "Partial Service Unreachability." in agent_input.query
    assert len(agent_input.symptoms) >= 1
    assert len(agent_input.tool_cache) == 2
    assert "DescribeResource" in agent_input.available_diagnostic_tools

    # Evaluator ground truth verification
    gt = sample_valid_case.ground_truth
    assert gt.root_cause == "missing_service_account"
    assert gt.fault_object == "app/adservice"
    assert gt.fault_taxonomy == "Admission_Fault"
    assert "service_account_not_found" in gt.valid_alternative_labels


def test_adapter_malformed_and_incomplete_records():
    """Verify that malformed records are marked unsupported with explicit reasons rather than silently dropped."""
    # 1. Missing case IDs
    res1 = CloudOpsBenchAdapter.parse_record({})
    assert res1.is_supported is False
    assert "Missing case_key and case_id" in (res1.exclusion_reason or "")

    # 2. Missing query and root cause
    res2 = CloudOpsBenchAdapter.parse_record({
        "case_key": "boutique/admission/99",
        "case_id": "99",
        "system": "boutique",
    })
    assert res2.is_supported is False
    assert "Missing required fields" in (res2.exclusion_reason or "")
    assert "query" in (res2.exclusion_reason or "")
    assert "root_cause" in (res2.exclusion_reason or "")


def test_ground_truth_leakage_prevention(sample_valid_case: NormalizedIncidentCase):
    """HARD GOVERNANCE REQUIREMENT: Prove ground truth is excluded from agent payload."""
    agent_input = sample_valid_case.get_agent_input()
    payload = agent_input.to_agent_payload()

    forbidden_keys = [
        "root_cause",
        "fault_object",
        "fault_taxonomy",
        "result",
        "milestone_path",
        "trajectory_paths",
        "golden_trajectory",
        "evaluator_notes",
        "valid_alternative_labels",
    ]

    for key in forbidden_keys:
        assert key not in payload, f"Ground truth leakage! '{key}' found in agent payload."

    # Verify that AgentIncidentInput forbids extra fields at schema level
    with pytest.raises(ValidationError):
        AgentIncidentInput(
            case_id="leak_test",
            system="boutique",
            namespace="boutique",
            query="test",
            root_cause="leaked_cause",  # type: ignore[call-arg]
        )


def test_top1_and_top3_accuracy_scoring():
    """Verify Top-1, Top-3, and miss calculations with exact label matching."""
    gt = EvaluatorGroundTruth(
        case_id="test_case",
        root_cause="cpu_limit_throttling",
        fault_object="app/cartservice",
        fault_taxonomy="Resource_Throttling",
        valid_alternative_labels=["cpu_starvation"],
    )

    # 1. Top-1 Match
    pred_top1 = {
        "top1_prediction": "cpu_limit_throttling",
        "top3_predictions": ["cpu_limit_throttling", "memory_leak", "timeout"],
        "confidence": 0.85,
    }
    res1 = evaluate_case("test_case", "boutique", "Cloud-OpsBench", pred_top1, gt)
    assert res1.top1_match is True
    assert res1.top3_match is True

    # 2. Top-3 Match (Correct label at rank 2, not rank 1)
    pred_top3 = {
        "top1_prediction": "memory_leak",
        "top3_predictions": ["memory_leak", "cpu_limit_throttling", "timeout"],
        "confidence": 0.60,
    }
    res2 = evaluate_case("test_case", "boutique", "Cloud-OpsBench", pred_top3, gt)
    assert res2.top1_match is False
    assert res2.top3_match is True

    # 3. Complete Miss (Correct label at rank 4 or absent)
    pred_miss = {
        "top1_prediction": "memory_leak",
        "top3_predictions": ["memory_leak", "disk_full", "dns_failure"],
        "confidence": 0.40,
    }
    res3 = evaluate_case("test_case", "boutique", "Cloud-OpsBench", pred_miss, gt)
    assert res3.top1_match is False
    assert res3.top3_match is False


def test_multiple_valid_alternative_labels():
    """Verify that recognized alternative labels count as correct matches."""
    gt = EvaluatorGroundTruth(
        case_id="alt_test",
        root_cause="null_pointer_exception",
        fault_object="app/paymentservice",
        fault_taxonomy="Code_Exception",
        valid_alternative_labels=["unhandled_type_error", "payment_code_defect"],
    )

    pred = {
        "top1_prediction": "unhandled_type_error",
        "top3_predictions": ["unhandled_type_error"],
        "confidence": 0.80,
    }
    res = evaluate_case("alt_test", "boutique", "Cloud-OpsBench", pred, gt)
    assert res.top1_match is True
    assert res.top3_match is True


def test_zero_denominator_and_empty_dataset():
    """Verify safe zero-denominator behavior when no cases are evaluated."""
    metrics = compute_dataset_metrics(
        evaluated_results=[],
        excluded_cases=[{"case_id": "c1", "reason": "MALFORMED"}],
        failed_cases=[],
        system_name="ProofLoop AI",
    )

    assert metrics["case_counts"]["total"] == 1
    assert metrics["case_counts"]["evaluated"] == 0
    assert metrics["case_counts"]["excluded"] == 1
    assert metrics["top1_accuracy"]["value"] == 0.0
    assert metrics["top1_accuracy"]["is_defined"] is False
    assert metrics["top1_accuracy"]["status"] == "not_applicable"
    assert metrics["top3_accuracy"]["is_defined"] is False


def test_unsupported_and_excluded_cases_accounting():
    """Verify explicit accounting of excluded cases during runner execution."""
    valid_raw = {
        "case_key": "boutique/admission/1",
        "case_id": "1",
        "system": "boutique",
        "category": "admission",
        "namespace": "boutique",
        "query": "Service down",
        "fault_object": "app/adservice",
        "fault_taxonomy": "Admission_Fault",
        "root_cause": "missing_service_account",
    }
    malformed_raw = {
        "case_key": "malformed_case",
        "case_id": "99",
    }

    case1 = CloudOpsBenchAdapter.parse_record(valid_raw)
    case2 = CloudOpsBenchAdapter.parse_record(malformed_raw)

    report = run_dataset_evaluation(cases=[case1, case2], seed=42)

    assert report["dataset"]["total_cases_loaded"] == 2
    assert report["dataset"]["eligible_evaluated_cases"] == 1
    assert report["dataset"]["excluded_cases_count"] == 1
    assert len(report["excluded_cases"]) == 1
    assert "Missing required fields" in report["excluded_cases"][0]["reason"]


def test_deterministic_fixture_runs():
    """Ensure runs against the synthetic fixture are 100% deterministic and require no network access."""
    fixture_path = Path(__file__).resolve().parent.parent.parent / "datasets" / "fixtures" / "cloud_opsbench_sample.json"
    assert fixture_path.exists(), "Sample fixture must exist for offline testing"

    report1 = run_dataset_evaluation(fixture_path=fixture_path, seed=42)
    report2 = run_dataset_evaluation(fixture_path=fixture_path, seed=42)

    assert report1["metrics"]["proofloop"]["top1_accuracy"]["value"] == report2["metrics"]["proofloop"]["top1_accuracy"]["value"]
    assert report1["metrics"]["baseline"]["top1_accuracy"]["value"] == report2["metrics"]["baseline"]["top1_accuracy"]["value"]
    assert report1["dataset"]["eligible_evaluated_cases"] == 5
    assert report1["dataset"]["excluded_cases_count"] == 0


def test_read_only_execution_invariant():
    """Verify that diagnosis evaluation never invokes mutating tools."""
    fixture_path = Path(__file__).resolve().parent.parent.parent / "datasets" / "fixtures" / "cloud_opsbench_sample.json"
    report = run_dataset_evaluation(fixture_path=fixture_path, seed=42)

    # Inspect all diagnostic tool calls recorded
    mutating_tools = {"rollback_config", "modify_database", "restart_service", "scale_service", "delete_database"}
    for case_eval in report["per_case_evaluation"]:
        diags = case_eval.get("diagnostics_called", [])
        for d in diags:
            tool_name = d.split(":", 1)[0].lower()
            assert tool_name not in mutating_tools, f"Mutating tool {tool_name} was invoked during read-only evaluation!"


def test_report_serialization_and_csv_export():
    """Verify full JSON and CSV report export."""
    fixture_path = Path(__file__).resolve().parent.parent.parent / "datasets" / "fixtures" / "cloud_opsbench_sample.json"
    report = run_dataset_evaluation(fixture_path=fixture_path, seed=42)

    with tempfile.TemporaryDirectory() as tmpdir:
        csv_path = Path(tmpdir) / "test_report.csv"
        export_report_csv(report, csv_path)

        assert csv_path.exists()
        with open(csv_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            rows = list(reader)
            assert len(rows) == 5
            assert "case_id" in rows[0]
            assert "top1_match" in rows[0]
            assert "ground_truth_root_cause" in rows[0]


def test_existing_synthetic_benchmark_compatibility():
    """Verify that Phase 3 / Phase 4 synthetic benchmark remains 100% compatible."""
    bench_result = run_benchmark(scenarios=["clean_recovery"], trials=1, seed=42)
    assert "metrics" in bench_result
    assert "proofloop" in bench_result["metrics"]
    assert "baseline" in bench_result["metrics"]
    assert bench_result["metrics"]["proofloop"]["total_runs"] == 1
    assert bench_result["metrics"]["baseline"]["total_runs"] == 1
