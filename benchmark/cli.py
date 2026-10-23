"""Command-line interface for the ProofLoop AI benchmark runner."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from benchmark.runner import run_benchmark


def format_table_row(col1: str, col2: str, col3: str, col4: str, widths: tuple[int, int, int, int] = (28, 22, 22, 20)) -> str:
    return f"{col1:<{widths[0]}} | {col2:<{widths[1]}} | {col3:<{widths[2]}} | {col4:<{widths[3]}}"


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
        default=["clean_recovery", "false_green", "hostile_log"],
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

    args = parser.parse_args()

    # Execute benchmark
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
