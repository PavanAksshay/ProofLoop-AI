from .models import VerificationCheck, VerificationReport
from .simulator import ServiceSimulator


def verify_recovery(simulator: ServiceSimulator, error_rate_threshold: float = 0.05) -> VerificationReport:
    """Read simulator state through read-only observations; never mutates it."""
    before = simulator.snapshot()
    probe = simulator.checkout_probe(count=5)
    observation = simulator.verifier_observation()

    checkout_passed = probe["failed"] == 0
    error_rate_passed = observation["error_rate"] <= error_rate_threshold
    config_passed = (
        observation["active_config"] == observation["expected_config"]
        and observation["dependencies_healthy"]
        and observation["process_running"]
    )

    checks = [
        VerificationCheck(
            check_name="synthetic_checkout",
            passed=checkout_passed,
            observed=probe,
        ),
        VerificationCheck(
            check_name="error_rate_window",
            passed=error_rate_passed,
            observed={"error_rate": observation["error_rate"], "threshold": error_rate_threshold, "simulated_minutes": observation["simulated_minutes"]},
        ),
        VerificationCheck(
            check_name="configuration_and_dependencies",
            passed=config_passed,
            observed={
                "active_config": observation["active_config"],
                "expected_config": observation["expected_config"],
                "dependencies_healthy": observation["dependencies_healthy"],
                "process_running": observation["process_running"],
            },
        ),
    ]

    # Defensive invariant: verifier reads must not mutate simulator state.
    if simulator.snapshot() != before:
        raise RuntimeError("Verifier violated read-only invariant")

    return VerificationReport(all_passed=all(check.passed for check in checks), checks=checks)
