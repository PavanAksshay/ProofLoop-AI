"""Scripted baseline incident-response runner for benchmark comparisons.

Represents a common legacy pattern: automated runbook scripts that check
basic service health status, apply a standard restart action, and declare success
if the basic HTTP health check returns 200.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from app.models import PolicyDecision, ToolRequest, ToolResult
from app.policy import evaluate_action
from app.simulator import ServiceSimulator


@dataclass
class BaselineExecution:
    """Record of a single baseline benchmark trial."""

    scenario: str
    client: str
    trial_index: int
    outcome: str  # "SUCCESS" | "FAILED"
    summary: str
    elapsed_ms: float
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    health_observed_initial: int = 500
    health_observed_final: int = 500
    unauthorized_mutations: int = 0
    policy_violations: list[dict[str, Any]] = field(default_factory=list)
    ground_truth_healthy: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "scenario": self.scenario,
            "client": self.client,
            "trial_index": self.trial_index,
            "outcome": self.outcome,
            "summary": self.summary,
            "elapsed_ms": round(self.elapsed_ms, 2),
            "tool_calls": self.tool_calls,
            "health_observed_initial": self.health_observed_initial,
            "health_observed_final": self.health_observed_final,
            "unauthorized_mutations": self.unauthorized_mutations,
            "policy_violations": self.policy_violations,
            "ground_truth_healthy": self.ground_truth_healthy,
        }


def run_baseline(
    simulator: ServiceSimulator,
    scenario: str,
    client: str,
    trial_index: int = 1,
) -> BaselineExecution:
    """Execute a simple scripted baseline on an isolated ServiceSimulator instance.

    Baseline Algorithm:
    1. Check initial service metrics (read_metrics).
    2. Health-based decision rule:
       - If initial HTTP health endpoint is 200 OK, declare SUCCESS immediately without remediation.
       - Otherwise, attempt predetermined remediation: restart_service.
    3. Re-check metrics after restart:
       - If post-action HTTP health endpoint returns 200 OK, declare SUCCESS.
       - Otherwise, declare FAILED.
    4. Record all executed actions and check for policy violations under client policy.
    5. Never receives ProofLoop independent verifier checks as input.

    Documented Limitations:
    - Confuses shallow HTTP 200 process health with end-to-end service correctness (false green).
    - Ignores configuration versions, application logs, and database errors.
    - Lacks policy awareness; executes restarts even when prohibited by client policy (e.g. Client B).
    """
    start_time = time.perf_counter()
    tool_calls: list[dict[str, Any]] = []
    policy_violations: list[dict[str, Any]] = []
    unauthorized_mutations = 0

    # Step 1: Initial health inspection
    initial_metrics_res = simulator.get_metrics("checkout-service")
    initial_health = int(initial_metrics_res.result.get("health_endpoint_status", 500))

    if initial_health == 200:
        # Scripted rule: health endpoint is already 200, assume recovery without action
        elapsed_ms = (time.perf_counter() - start_time) * 1000.0
        from benchmark.evaluator import is_ground_truth_healthy

        ground_truth = is_ground_truth_healthy(simulator)

        return BaselineExecution(
            scenario=scenario,
            client=client,
            trial_index=trial_index,
            outcome="SUCCESS",
            summary="Initial health check returned HTTP 200 OK; baseline declared service healthy without mutation.",
            elapsed_ms=elapsed_ms,
            tool_calls=[],
            health_observed_initial=initial_health,
            health_observed_final=initial_health,
            unauthorized_mutations=0,
            policy_violations=[],
            ground_truth_healthy=ground_truth,
        )

    # Step 2: Predetermined remediation — restart the service
    action = ToolRequest(tool="restart_service", service="checkout-service")

    # Audit policy compliance of this action (the baseline does not self-block, but we record violations)
    policy_eval = evaluate_action(action, client)
    is_unauthorized = policy_eval.decision != PolicyDecision.ALLOWED
    if is_unauthorized:
        unauthorized_mutations += 1
        policy_violations.append({
            "tool": action.tool,
            "service": action.service,
            "decision": policy_eval.decision.value,
            "rule_id": policy_eval.rule_id,
            "reason": policy_eval.reason,
        })

    # Execute action on the simulator
    exec_result: ToolResult = simulator.execute(action)
    tool_calls.append({
        "tool": action.tool,
        "service": action.service,
        "arguments": action.arguments,
        "success": exec_result.success,
        "result": exec_result.result,
        "unauthorized": is_unauthorized,
    })

    # Step 3: Post-action health check
    post_metrics_res = simulator.get_metrics("checkout-service")
    final_health = int(post_metrics_res.result.get("health_endpoint_status", 500))

    if final_health == 200:
        outcome = "SUCCESS"
        summary = "Service restarted successfully; basic health check returned HTTP 200 OK."
    else:
        outcome = "FAILED"
        summary = f"Service restart completed, but health check remained degraded (HTTP {final_health})."

    elapsed_ms = (time.perf_counter() - start_time) * 1000.0

    from benchmark.evaluator import is_ground_truth_healthy

    ground_truth = is_ground_truth_healthy(simulator)

    return BaselineExecution(
        scenario=scenario,
        client=client,
        trial_index=trial_index,
        outcome=outcome,
        summary=summary,
        elapsed_ms=elapsed_ms,
        tool_calls=tool_calls,
        health_observed_initial=initial_health,
        health_observed_final=final_health,
        unauthorized_mutations=unauthorized_mutations,
        policy_violations=policy_violations,
        ground_truth_healthy=ground_truth,
    )
