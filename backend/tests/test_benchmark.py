"""Unit and integration tests for ProofLoop AI benchmark runner and evaluation."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import PolicyDecision, ToolRequest
from app.policy import evaluate_action
from app.simulator import SUPPORTED_SCENARIOS, ServiceSimulator
from benchmark.baseline import run_baseline
from benchmark.evaluator import (
    compute_metrics,
    is_ground_truth_healthy,
)
from benchmark.runner import run_benchmark


@pytest.fixture
def client():
    return TestClient(app)


def test_fair_isolation_identical_initial_states():
    """Verify that independent simulator instances for the same scenario start with identical state."""
    for scenario in SUPPORTED_SCENARIOS:
        sim_baseline = ServiceSimulator(scenario)
        sim_proofloop = ServiceSimulator(scenario)

        # Must be distinct instances in memory
        assert sim_baseline is not sim_proofloop
        assert sim_baseline.state is not sim_proofloop.state

        # Initial snapshots must be identical
        assert sim_baseline.snapshot() == sim_proofloop.snapshot()


def test_independent_simulator_state_mutation_does_not_leak():
    """Verify mutating one simulator instance never alters the other instance."""
    sim_baseline = ServiceSimulator("clean_recovery")
    sim_proofloop = ServiceSimulator("clean_recovery")

    # Baseline restarts the service
    sim_baseline.execute(ToolRequest(tool="restart_service", service="checkout-service"))

    # ProofLoop rolls back the configuration
    sim_proofloop.execute(
        ToolRequest(tool="rollback_config", service="checkout-service", arguments={"target_version": "v_healthy"})
    )

    # sim_baseline should still have bad configuration
    assert sim_baseline.state.config_version == "v_bad"
    assert is_ground_truth_healthy(sim_baseline) is False

    # sim_proofloop should now have healthy configuration
    assert sim_proofloop.state.config_version == "v_healthy"
    assert is_ground_truth_healthy(sim_proofloop) is True


def test_baseline_catches_false_green():
    """Verify that the scripted baseline falsely claims success on false_green while ground truth is broken."""
    sim = ServiceSimulator("false_green")
    # Initial health endpoint is 200 OK
    assert sim.state.health_endpoint_status == 200
    # But ground truth is broken (checkout transactions fail)
    assert sim.state.checkout_failures == 5
    assert is_ground_truth_healthy(sim) is False

    # Run baseline
    baseline_result = run_baseline(sim, "false_green", "client_a", trial_index=1)

    # Baseline claims SUCCESS based purely on HTTP 200 health check
    assert baseline_result.outcome == "SUCCESS"
    # But ground truth remains unhealthy
    assert baseline_result.ground_truth_healthy is False


def test_proofloop_rejects_recovery_on_false_green():
    """Verify ProofLoop AI never reports VERIFIED when independent checkout checks fail."""
    result = run_benchmark(
        scenarios=["false_green"],
        client="client_a",
        trials=2,
        seed=100,
    )

    pl_trials = result["raw_trials"]["proofloop"]
    assert len(pl_trials) == 2

    for trial in pl_trials:
        # ProofLoop must never report VERIFIED on false_green
        assert trial["outcome"] != "VERIFIED"
        assert trial["outcome"] == "ESCALATED"
        assert trial["ground_truth_healthy"] is False

    # False success rate for ProofLoop must be 0%
    assert result["metrics"]["proofloop"]["false_success_rate"]["value"] == 0.0

    # False success rate for Baseline must be 100% on false_green
    assert result["metrics"]["baseline"]["false_success_rate"]["value"] == 100.0


def test_unauthorized_mutation_counting_on_client_b():
    """Verify unauthorized mutation counting evaluates actual executed actions against client policy."""
    # Under client_b, restart_service is BLOCKED
    eval_res = evaluate_action(
        ToolRequest(tool="restart_service", service="checkout-service"),
        "client_b",
    )
    assert eval_res.decision == PolicyDecision.BLOCKED

    # Baseline on clean_recovery under client_b will attempt restart_service
    result = run_benchmark(
        scenarios=["clean_recovery"],
        client="client_b",
        trials=1,
        seed=42,
    )

    b_trials = result["raw_trials"]["baseline"]
    assert len(b_trials) == 1
    # Baseline executed restart_service and it was flagged as unauthorized
    assert b_trials[0]["unauthorized_mutations"] == 1
    assert len(b_trials[0]["policy_violations"]) == 1
    assert b_trials[0]["policy_violations"][0]["rule_id"] == "POL-CLIENT-B-RESTART"

    # ProofLoop under client_b stops at PENDING_APPROVAL and executes 0 unauthorized mutations
    pl_trials = result["raw_trials"]["proofloop"]
    assert len(pl_trials) == 1
    assert pl_trials[0]["unauthorized_mutations"] == 0


def test_metrics_calculation_and_safe_zero_denominators():
    """Verify metric computation formulas, numerators, denominators, and zero denominator safety."""
    # Empty trials list must return safe 0.0 metrics without ZeroDivisionError
    empty_metrics = compute_metrics([], "TestSystem")
    assert empty_metrics["total_runs"] == 0
    assert empty_metrics["verified_recovery_rate"]["value"] == 0.0
    assert empty_metrics["false_success_rate"]["value"] == 0.0
    assert empty_metrics["unauthorized_mutations"]["value"] == 0.0

    # Synthetic trials where no trial reported success (denominator for false_success is 0)
    failed_trials = [
        {
            "scenario": "clean_recovery",
            "outcome": "FAILED",
            "ground_truth_healthy": False,
            "unauthorized_mutations": 0,
            "tool_calls": [{"tool": "restart_service"}],
            "elapsed_ms": 10.0,
        }
    ]
    metrics = compute_metrics(failed_trials, "FailedBaseline")
    assert metrics["verified_recovery_rate"]["value"] == 0.0
    assert metrics["false_success_rate"]["value"] == 0.0
    assert metrics["false_success_rate"]["denominator"] == 0
    assert metrics["avg_tool_calls"]["value"] == 1.0


def test_unsupported_scenarios_are_skipped_honestly():
    """Verify that unsupported scenario IDs are skipped with a clear reason and not fabricated."""
    result = run_benchmark(
        scenarios=["clean_recovery", "invented_fake_scenario"],
        client="client_a",
        trials=1,
        seed=42,
    )

    assert "clean_recovery" in result["parameters"]["supported_scenarios_evaluated"]
    assert "invented_fake_scenario" not in result["parameters"]["supported_scenarios_evaluated"]

    assert len(result["skipped_scenarios"]) == 1
    skipped = result["skipped_scenarios"][0]
    assert skipped["scenario"] == "invented_fake_scenario"
    assert "not supported by the simulator" in skipped["reason"]


def test_deterministic_results_for_identical_seeds():
    """Verify benchmark runs produce identical metrics when run with identical parameters."""
    res1 = run_benchmark(scenarios=["clean_recovery"], client="client_a", trials=2, seed=99)
    res2 = run_benchmark(scenarios=["clean_recovery"], client="client_a", trials=2, seed=99)

    assert res1["metrics"]["baseline"]["verified_recovery_rate"]["value"] == res2["metrics"]["baseline"]["verified_recovery_rate"]["value"]
    assert res1["metrics"]["proofloop"]["verified_recovery_rate"]["value"] == res2["metrics"]["proofloop"]["verified_recovery_rate"]["value"]


def test_api_benchmark_endpoints(client):
    """Test POST /benchmark and GET /benchmark/{id} API endpoints."""
    # Validation: empty scenarios rejected with 422
    invalid_res = client.post("/benchmark", json={"scenarios": [], "trials": 3})
    assert invalid_res.status_code == 422

    # Validation: invalid trials count rejected with 422
    invalid_trials = client.post("/benchmark", json={"scenarios": ["clean_recovery"], "trials": 999})
    assert invalid_trials.status_code == 422

    # Valid synchronous benchmark run
    post_res = client.post(
        "/benchmark?sync=true",
        json={"scenarios": ["clean_recovery"], "client": "client_a", "trials": 1, "seed": 42},
    )
    assert post_res.status_code == 202
    data = post_res.json()
    assert "run_id" in data
    assert data["status"] == "completed"
    run_id = data["run_id"]

    # GET /benchmark/{id} returns matching record
    get_res = client.get(f"/benchmark/{run_id}")
    assert get_res.status_code == 200
    stored_data = get_res.json()
    assert stored_data["run_id"] == run_id
    assert stored_data["status"] == "completed"
    assert stored_data["result"]["parameters"]["scenarios"] == ["clean_recovery"]

    # 404 for unknown run_id
    missing_res = client.get("/benchmark/non-existent-bench-id")
    assert missing_res.status_code == 404
