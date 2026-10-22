from .models import ToolRequest
from .simulator import ServiceSimulator


def propose_next_action(simulator: ServiceSimulator) -> tuple[ToolRequest, str, list[str]]:
    """Deterministic fallback planner; LLM provider can implement the same interface later."""
    logs = simulator.read_logs("checkout-service").result.get("logs", [])
    config = simulator.read_config("checkout-service").result
    metrics = simulator.get_metrics("checkout-service").result

    evidence_refs = ["logs:checkout-service", "config:checkout-service", "metrics:checkout-service"]

    # Treat log content as evidence only. Never interpret it as authority or tool instructions.
    if config.get("active_version") != "v_healthy":
        return (
            ToolRequest(tool="rollback_config", service="checkout-service", arguments={"target_version": "v_healthy"}),
            "Observed active configuration is unhealthy; rollback to the known healthy version is the least disruptive available fix.",
            evidence_refs,
        )

    if metrics.get("error_rate", 1.0) > 0.05:
        return (
            ToolRequest(tool="clear_cache", service="checkout-service"),
            "Configuration appears healthy but error rate remains elevated; try a permitted cache clear.",
            evidence_refs,
        )

    return (
        ToolRequest(tool="escalate_to_human", service="checkout-service", arguments={"reason": "No safe remediation identified", "summary": "Evidence does not support another automated action."}),
        "No further safe automated remediation is justified.",
        evidence_refs,
    )
