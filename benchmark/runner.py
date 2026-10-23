"""Benchmark runner coordinating isolated trials between Baseline and ProofLoop AI."""
from __future__ import annotations

import random
import subprocess
import time
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from app.models import IncidentRunRequest, PolicyDecision, ToolRequest
from app.orchestrator import run_incident
from app.policy import evaluate_action
from app.simulator import SUPPORTED_SCENARIOS, ServiceSimulator
from benchmark.baseline import run_baseline
from benchmark.evaluator import compute_metrics, is_ground_truth_healthy


def get_software_revision() -> str:
    """Attempt to retrieve the git commit hash for reproducibility metadata."""
    try:
        rev = (
            subprocess.check_output(
                ["git", "rev-parse", "--short", "HEAD"],
                stderr=subprocess.DEVNULL,
            )
            .decode("utf-8")
            .strip()
        )
        return rev or "0.3.0"
    except Exception:
        return "0.3.0"


def run_benchmark(
    scenarios: list[str],
    client: str = "client_a",
    trials: int = 3,
    seed: int = 42,
    run_id: str | None = None,
) -> dict[str, Any]:
    """Execute a reproducible benchmark comparing ProofLoop against the scripted baseline.

    Guarantees:
    - Independent simulator instances for each trial.
    - Identical initial conditions and seeds.
    - Zero state leakage between systems.
    - Interactive incidents in the store are never corrupted (record_to_store=False).
    - Unsupported scenarios are honestly reported as skipped with reasons.
    """
    bench_id = run_id or f"bench-{uuid4().hex[:12]}"
    created_at = datetime.now(timezone.utc).isoformat()
    software_revision = get_software_revision()

    supported_to_run: list[str] = []
    skipped_scenarios: list[dict[str, str]] = []

    for s in scenarios:
        if s in SUPPORTED_SCENARIOS:
            supported_to_run.append(s)
        else:
            skipped_scenarios.append({
                "scenario": s,
                "reason": f"Scenario '{s}' is not supported by the simulator. Supported scenarios: {sorted(SUPPORTED_SCENARIOS)}",
            })

    baseline_trials: list[dict[str, Any]] = []
    proofloop_trials: list[dict[str, Any]] = []
    per_scenario_results: dict[str, Any] = {}

    for scenario in supported_to_run:
        scenario_baseline_trials: list[dict[str, Any]] = []
        scenario_proofloop_trials: list[dict[str, Any]] = []

        for trial_idx in range(1, trials + 1):
            # Fair isolation: Set reproducible seed for each trial
            trial_seed = seed + trial_idx
            random.seed(trial_seed)

            # Create strictly independent simulator instances
            sim_baseline = ServiceSimulator(scenario)
            sim_proofloop = ServiceSimulator(scenario)

            # Assert complete isolation and identical initial conditions
            assert sim_baseline is not sim_proofloop, "Simulators must be separate objects in memory"
            assert sim_baseline.snapshot() == sim_proofloop.snapshot(), "Simulators must start with identical state"

            # 1. Run Scripted Baseline
            baseline_record = run_baseline(
                simulator=sim_baseline,
                scenario=scenario,
                client=client,
                trial_index=trial_idx,
            ).to_dict()
            baseline_record["seed"] = trial_seed
            baseline_trials.append(baseline_record)
            scenario_baseline_trials.append(baseline_record)

            # 2. Run ProofLoop AI
            start_time = time.perf_counter()
            proofloop_incident_id = f"{bench_id}-{scenario}-t{trial_idx}"
            
            pl_response = run_incident(
                request=IncidentRunRequest(
                    scenario=scenario,
                    client=client,
                    mode="fallback",
                ),
                incident_id=proofloop_incident_id,
                simulator=sim_proofloop,
                record_to_store=False,  # Isolate from interactive dashboard incidents
            )
            elapsed_ms = (time.perf_counter() - start_time) * 1000.0

            # Direct ground truth inspection of ProofLoop simulator state
            pl_ground_truth = is_ground_truth_healthy(sim_proofloop)

            # Audit executed actions for policy compliance
            pl_tool_calls: list[dict[str, Any]] = []
            pl_policy_violations: list[dict[str, Any]] = []
            pl_unauthorized_count = 0

            for ev in pl_response.events:
                if ev.type == "tool_executed":
                    tool = ev.payload.get("tool", "")
                    service = ev.payload.get("service", "checkout-service")
                    args = ev.payload.get("arguments", {})
                    
                    req = ToolRequest(tool=tool, service=service, arguments=args)
                    pol = evaluate_action(req, client)
                    is_unauth = pol.decision != PolicyDecision.ALLOWED
                    
                    if is_unauth:
                        pl_unauthorized_count += 1
                        pl_policy_violations.append({
                            "tool": tool,
                            "service": service,
                            "decision": pol.decision.value,
                            "rule_id": pol.rule_id,
                            "reason": pol.reason,
                        })
                    
                    pl_tool_calls.append({
                        "tool": tool,
                        "service": service,
                        "arguments": args,
                        "success": ev.payload.get("success", True),
                        "result": ev.payload.get("result", {}),
                        "unauthorized": is_unauth,
                    })

            # Collect verification checks
            verification_checks = [
                ev.payload for ev in pl_response.events if ev.type == "verification_check"
            ]

            pl_record: dict[str, Any] = {
                "scenario": scenario,
                "client": client,
                "trial_index": trial_idx,
                "seed": trial_seed,
                "outcome": pl_response.outcome.value,
                "summary": pl_response.summary,
                "elapsed_ms": round(elapsed_ms, 2),
                "tool_calls": pl_tool_calls,
                "unauthorized_mutations": pl_unauthorized_count,
                "policy_violations": pl_policy_violations,
                "ground_truth_healthy": pl_ground_truth,
                "verification_checks": verification_checks,
            }
            proofloop_trials.append(pl_record)
            scenario_proofloop_trials.append(pl_record)

        # Per-scenario breakdown metrics
        per_scenario_results[scenario] = {
            "baseline": compute_metrics(scenario_baseline_trials, "Baseline"),
            "proofloop": compute_metrics(scenario_proofloop_trials, "ProofLoop AI"),
            "trials_count": len(scenario_baseline_trials),
        }

    # Aggregate overall metrics across all scenarios
    overall_baseline_metrics = compute_metrics(baseline_trials, "Baseline")
    overall_proofloop_metrics = compute_metrics(proofloop_trials, "ProofLoop AI")

    return {
        "run_id": bench_id,
        "timestamp": created_at,
        "software_revision": software_revision,
        "parameters": {
            "scenarios": scenarios,
            "supported_scenarios_evaluated": supported_to_run,
            "client": client,
            "trials_per_scenario": trials,
            "seed": seed,
        },
        "metrics": {
            "baseline": overall_baseline_metrics,
            "proofloop": overall_proofloop_metrics,
        },
        "per_scenario": per_scenario_results,
        "raw_trials": {
            "baseline": baseline_trials,
            "proofloop": proofloop_trials,
        },
        "skipped_scenarios": skipped_scenarios,
        "disclaimer": "All measurements are derived from deterministic synthetic service simulations. No production services are modified.",
    }
