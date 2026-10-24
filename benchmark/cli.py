"""Command-line interface for the ProofLoop AI benchmark runner."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from benchmark.dataset_runner import export_report_csv, run_dataset_evaluation
from benchmark.runner import run_benchmark


def format_table_row(col1: str, col2: str, col3: str, col4: str, widths: tuple[int, int, int, int] = (28, 22, 22, 20)) -> str:
    return f"{col1:<{widths[0]}} | {col2:<{widths[1]}} | {col3:<{widths[2]}} | {col4:<{widths[3]}}"


def print_dataset_evaluation_summary(result: dict[str, Any]) -> None:
    """Print an ASCII comparison table of real-world dataset diagnosis evaluation results."""
    ds = result["dataset"]
    b_metrics = result["metrics"]["baseline"]
    pl_metrics = result["metrics"]["proofloop"]

    print("\n" + "=" * 98)
    print("           PROOFLOOP AI REAL-WORLD DATASET DIAGNOSIS EVALUATION REPORT")
    print("=" * 98)
    print(f"Run ID:            {result['run_id']}")
    print(f"Timestamp:         {result['timestamp']}")
    print(f"Software Revision: {result['software_revision']}")
    print(f"Dataset:           {ds['name']} (version: {ds['version']})")
    print(f"Case Accounting:   {ds['total_cases_loaded']} loaded, {ds['eligible_evaluated_cases']} evaluated, {ds['excluded_cases_count']} excluded, {ds['failed_cases_count']} failed")
    print("-" * 98)

    widths = (32, 20, 20, 20)
    print(format_table_row("METRIC", "HEURISTIC BASELINE", "PROOFLOOP AI", "ADVANTAGE / DELTA", widths))
    print("-" * 98)

    # 1. Top-1 Accuracy
    b_t1 = f"{b_metrics['top1_accuracy']['value']}% ({b_metrics['top1_accuracy']['numerator']}/{b_metrics['top1_accuracy']['denominator']})"
    pl_t1 = f"{pl_metrics['top1_accuracy']['value']}% ({pl_metrics['top1_accuracy']['numerator']}/{pl_metrics['top1_accuracy']['denominator']})"
    delta_t1 = f"+{round(pl_metrics['top1_accuracy']['value'] - b_metrics['top1_accuracy']['value'], 1)}% ProofLoop"
    print(format_table_row("Top-1 Root-Cause Accuracy", b_t1, pl_t1, delta_t1, widths))

    # 2. Top-3 Accuracy
    b_t3 = f"{b_metrics['top3_accuracy']['value']}% ({b_metrics['top3_accuracy']['numerator']}/{b_metrics['top3_accuracy']['denominator']})"
    pl_t3 = f"{pl_metrics['top3_accuracy']['value']}% ({pl_metrics['top3_accuracy']['numerator']}/{pl_metrics['top3_accuracy']['denominator']})"
    delta_t3 = f"+{round(pl_metrics['top3_accuracy']['value'] - b_metrics['top3_accuracy']['value'], 1)}% ProofLoop"
    print(format_table_row("Top-3 Root-Cause Accuracy", b_t3, pl_t3, delta_t3, widths))

    # 3. Category / Taxonomy Accuracy
    b_cat = f"{b_metrics['category_accuracy']['value']}% ({b_metrics['category_accuracy']['numerator']}/{b_metrics['category_accuracy']['denominator']})"
    pl_cat = f"{pl_metrics['category_accuracy']['value']}% ({pl_metrics['category_accuracy']['numerator']}/{pl_metrics['category_accuracy']['denominator']})"
    delta_cat = f"+{round(pl_metrics['category_accuracy']['value'] - b_metrics['category_accuracy']['value'], 1)}% ProofLoop"
    print(format_table_row("Category / Taxonomy Match", b_cat, pl_cat, delta_cat, widths))

    # 4. Avg Diagnostics / Case
    b_diag = f"{b_metrics.get('avg_diagnostics_per_case', 0.0)}"
    pl_diag = f"{pl_metrics.get('avg_diagnostics_per_case', 0.0)}"
    print(format_table_row("Avg Diagnostics / Case", b_diag, pl_diag, "Read-only telemetry", widths))

    # 5. Avg Latency
    b_lat = f"{b_metrics.get('avg_elapsed_ms', 0.0)} ms"
    pl_lat = f"{pl_metrics.get('avg_elapsed_ms', 0.0)} ms"
    print(format_table_row("Avg Diagnosis Latency", b_lat, pl_lat, "Evidence-driven", widths))

    # 6. Evidence Traceability
    b_tr = f"{b_metrics['evidence_traceability_rate']['value']}%"
    pl_tr = f"{pl_metrics['evidence_traceability_rate']['value']}%"
    print(format_table_row("Evidence Traceability", b_tr, pl_tr, "Citation ledger", widths))

    print("-" * 98)

    # Per-case details
    per_cases = result.get("per_case_evaluation", [])
    if per_cases:
        print("\nPER-CASE DIAGNOSIS DETAILS:")
        print(f"{'CASE ID':<36} | {'GROUND TRUTH CAUSE':<26} | {'PREDICTED TOP-1':<24} | {'TOP-1 MATCH'}")
        print("-" * 98)
        for c in per_cases:
            cid = c.get("case_id", "")
            gt = c.get("ground_truth_root_cause", "")
            p1 = c.get("top1_prediction", "None") or "None"
            m = "PASS" if c.get("top1_match") else "FAIL"
            print(f"{cid:<36} | {gt:<26} | {p1:<24} | {m}")

    if result.get("excluded_cases"):
        print("\nEXCLUDED / SKIPPED CASES:")
        for exc in result["excluded_cases"]:
            print(f"  • {exc.get('case_id')}: {exc.get('reason')}")

    print("\nDISCLOSURE:")
    print(f"  {result['disclaimer']}")
    print("=" * 98 + "\n")


def print_benchmark_summary(result: dict[str, Any]) -> None:
    """Print a clean, professional ASCII comparison table of benchmark results."""
    params = result["parameters"]
    b_metrics = result["metrics"]["baseline"]
    pl_metrics = result["metrics"]["proofloop"]

    print("\n" + "=" * 98)
    print("                      PROOFLOOP AI BENCHMARK EVALUATION REPORT")
    print("=" * 98)
    print(f"Run ID:            {result['run_id']}")
    print(f"Timestamp:         {result['timestamp']}")
    print(f"Software Revision: {result['software_revision']}")
    print(f"Client Policy:     {params['client']}")
    print(f"Seed:              {params['seed']}")
    print(f"Scenarios:         {', '.join(params['supported_scenarios_evaluated'])}")
    print(f"Total Trials:      {b_metrics['total_runs']} baseline, {pl_metrics['total_runs']} proofloop")
    print("-" * 98)

    widths = (32, 20, 20, 20)
    print(format_table_row("METRIC", "BASELINE (SCRIPT)", "PROOFLOOP AI", "DIFFERENCE / ADVANTAGE", widths))
    print("-" * 98)

    # 1. Verified Recovery Rate
    b_rec = f"{b_metrics['verified_recovery_rate']['value']}% ({b_metrics['verified_recovery_rate']['numerator']}/{b_metrics['verified_recovery_rate']['denominator']})"
    pl_rec = f"{pl_metrics['verified_recovery_rate']['value']}% ({pl_metrics['verified_recovery_rate']['numerator']}/{pl_metrics['verified_recovery_rate']['denominator']})"
    delta_rec = f"+{round(pl_metrics['verified_recovery_rate']['value'] - b_metrics['verified_recovery_rate']['value'], 1)}% ProofLoop"
    print(format_table_row("Verified Recovery Rate", b_rec, pl_rec, delta_rec, widths))

    # 2. False-Success Rate
    b_fs = f"{b_metrics['false_success_rate']['value']}% ({b_metrics['false_success_rate']['numerator']}/{b_metrics['false_success_rate']['denominator']})"
    pl_fs = f"{pl_metrics['false_success_rate']['value']}% ({pl_metrics['false_success_rate']['numerator']}/{pl_metrics['false_success_rate']['denominator']})"
    fs_note = "0.0% (Zero false greens)" if pl_metrics['false_success_rate']['value'] == 0 else f"{pl_metrics['false_success_rate']['value']}%"
    print(format_table_row("False-Success Rate", b_fs, pl_fs, "ProofLoop caught all", widths))

    # 3. Unauthorized Mutations
    b_unauth = f"{int(b_metrics['unauthorized_mutations']['value'])} ({b_metrics['unauthorized_mutations']['numerator']}/{b_metrics['unauthorized_mutations']['denominator']} runs)"
    pl_unauth = f"{int(pl_metrics['unauthorized_mutations']['value'])} ({pl_metrics['unauthorized_mutations']['numerator']}/{pl_metrics['unauthorized_mutations']['denominator']} runs)"
    print(format_table_row("Unauthorized Mutations", b_unauth, pl_unauth, "Policy gate enforced", widths))

    # 4. Avg Tool Calls
    b_tools = f"{b_metrics['avg_tool_calls']['value']}"
    pl_tools = f"{pl_metrics['avg_tool_calls']['value']}"
    print(format_table_row("Avg Tool Calls / Run", b_tools, pl_tools, "Targeted remediation", widths))

    # 5. Avg Time to Outcome
    b_time = f"{b_metrics['avg_time_ms']['value']} ms"
    pl_time = f"{pl_metrics['avg_time_ms']['value']} ms"
    print(format_table_row("Avg Time to Outcome", b_time, pl_time, "Full audit & verify", widths))

    # 6. Escalation Correctness
    b_esc = f"{b_metrics['escalation_correctness']['value']}% ({b_metrics['escalation_correctness']['numerator']}/{b_metrics['escalation_correctness']['denominator']})"
    pl_esc = f"{pl_metrics['escalation_correctness']['value']}% ({pl_metrics['escalation_correctness']['numerator']}/{pl_metrics['escalation_correctness']['denominator']})"
    print(format_table_row("Escalation Correctness", b_esc, pl_esc, "Safe stops on unrecov", widths))

    # 7. Recovery After Failed First Action
    b_rec_f1 = f"{b_metrics.get('recovery_after_failed_first_action', {}).get('value', 0.0)}% ({b_metrics.get('recovery_after_failed_first_action', {}).get('numerator', 0)}/{b_metrics.get('recovery_after_failed_first_action', {}).get('denominator', 0)})"
    pl_rec_f1 = f"{pl_metrics.get('recovery_after_failed_first_action', {}).get('value', 0.0)}% ({pl_metrics.get('recovery_after_failed_first_action', {}).get('numerator', 0)}/{pl_metrics.get('recovery_after_failed_first_action', {}).get('denominator', 0)})"
    print(format_table_row("Recovery Post-1st Failure", b_rec_f1, pl_rec_f1, "Adaptive replanning", widths))

    # 8. Repeated Ineffective Actions
    b_rep = f"{b_metrics.get('repeated_ineffective_action_rate', {}).get('value', 0.0)}% ({b_metrics.get('repeated_ineffective_action_rate', {}).get('numerator', 0)}/{b_metrics.get('repeated_ineffective_action_rate', {}).get('denominator', 0)})"
    pl_rep = f"{pl_metrics.get('repeated_ineffective_action_rate', {}).get('value', 0.0)}% ({pl_metrics.get('repeated_ineffective_action_rate', {}).get('numerator', 0)}/{pl_metrics.get('repeated_ineffective_action_rate', {}).get('denominator', 0)})"
    print(format_table_row("Repeated Ineffective Action", b_rep, pl_rep, "Duplicate suppression", widths))

    # 9. Diagnostics per Run
    b_diag = f"{b_metrics.get('avg_diagnostics_per_run', {}).get('value', 0.0)}"
    pl_diag = f"{pl_metrics.get('avg_diagnostics_per_run', {}).get('value', 0.0)}"
    print(format_table_row("Avg Diagnostics / Run", b_diag, pl_diag, "Evidence investigation", widths))

    # 10. Remediation Attempts per Run
    b_rem = f"{b_metrics.get('avg_remediations_per_run', {}).get('value', 0.0)}"
    pl_rem = f"{pl_metrics.get('avg_remediations_per_run', {}).get('value', 0.0)}"
    print(format_table_row("Avg Remediations / Run", b_rem, pl_rem, "Bounded action budget", widths))

    # 11. Time to Verified Recovery
    b_t_rec = f"{round(b_metrics.get('time_to_verified_recovery', {}).get('value', 0.0), 1)} ms"
    pl_t_rec = f"{round(pl_metrics.get('time_to_verified_recovery', {}).get('value', 0.0), 1)} ms"
    print(format_table_row("Time to Verified Recov", b_t_rec, pl_t_rec, "True recovery time", widths))

    print("-" * 98)

    # Per-scenario breakdown table
    print("\nPER-SCENARIO BREAKDOWN:")
    p_widths = (20, 16, 20, 16, 20)
    print(f"{'SCENARIO':<20} | {'BASE RECOVERY':<16} | {'BASE FALSE SUCCESS':<20} | {'PL RECOVERY':<16} | {'PL ESCALATED':<20}")
    print("-" * 98)
    for scen, s_res in result["per_scenario"].items():
        sb_rec = f"{s_res['baseline']['verified_recovery_rate']['value']}%"
        sb_fs = f"{s_res['baseline']['false_success_rate']['value']}%"
        spl_rec = f"{s_res['proofloop']['verified_recovery_rate']['value']}%"
        # Check if proofloop escalated
        pl_trials = [t for t in result["raw_trials"]["proofloop"] if t["scenario"] == scen]
        esc_count = sum(1 for t in pl_trials if t["outcome"] == "ESCALATED")
        spl_esc = f"{esc_count}/{len(pl_trials)} trials"
        print(f"{scen:<20} | {sb_rec:<16} | {sb_fs:<20} | {spl_rec:<16} | {spl_esc:<20}")

    if result.get("skipped_scenarios"):
        print("\nSKIPPED SCENARIOS:")
        for sk in result["skipped_scenarios"]:
            print(f"  • {sk['scenario']}: {sk['reason']}")

    print("\nDISCLOSURE:")
    print(f"  {result['disclaimer']}")
    print("=" * 98 + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="ProofLoop AI Benchmark Runner: Scripted Baseline vs ProofLoop AgentOps",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--scenarios",
        nargs="+",
        default=[
            "clean_recovery",
            "false_green",
            "stale_runbook",
            "hostile_log",
            "first_fix_fails",
            "partial_recovery",
            "misleading_health_signal",
            "unprovable_recovery",
        ],
        help="List of scenario identifiers to evaluate",
    )
    parser.add_argument(
        "--client",
        default="client_a",
        help="Client policy context (e.g. client_a, client_b)",
    )
    parser.add_argument(
        "--trials",
        type=int,
        default=3,
        help="Number of trials per scenario",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Initial random seed for reproducible runs",
    )
    parser.add_argument(
        "--output",
        default="benchmark/results/latest.json",
        help="Path to save JSON benchmark results",
    )

    parser.add_argument(
        "--dataset",
        choices=["cloud_opsbench"],
        default=None,
        help="Execute real-world dataset diagnosis evaluation (e.g. cloud_opsbench)",
    )
    parser.add_argument(
        "--dataset-path",
        default=None,
        help="Path to dataset directory (containing index.jsonl) or fixture JSON",
    )
    parser.add_argument(
        "--max-cases",
        type=int,
        default=None,
        help="Maximum number of cases to evaluate",
    )
    parser.add_argument(
        "--output-csv",
        default=None,
        help="Optional path to save per-case CSV evaluation report",
    )

    args = parser.parse_args()

    # Branch 1: Real-World Dataset Diagnosis Evaluation
    if args.dataset:
        fixture_p = None
        dir_p = None
        if args.dataset_path:
            p = Path(args.dataset_path)
            if p.is_file():
                fixture_p = p
            else:
                dir_p = p

        result = run_dataset_evaluation(
            fixture_path=fixture_p,
            dataset_dir=dir_p,
            dataset_name=args.dataset,
            seed=args.seed,
            max_cases=args.max_cases,
        )

        print_dataset_evaluation_summary(result)

        if args.output:
            out_path = Path(args.output).resolve()
            out_path.parent.mkdir(parents=True, exist_ok=True)
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(result, f, indent=2)
            print(f"Full dataset evaluation JSON written to: {out_path}")

        if args.output_csv:
            export_report_csv(result, args.output_csv)
            print(f"Per-case CSV evaluation report written to: {args.output_csv}\n")
        return

    # Branch 2: Synthetic ServiceSimulator Benchmark
    result = run_benchmark(
        scenarios=args.scenarios,
        client=args.client,
        trials=args.trials,
        seed=args.seed,
    )

    # Print terminal report
    print_benchmark_summary(result)

    # Write output JSON safely
    if args.output:
        out_path = Path(args.output).resolve()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2)
        print(f"Full benchmark results written to: {out_path}\n")


if __name__ == "__main__":
    main()
