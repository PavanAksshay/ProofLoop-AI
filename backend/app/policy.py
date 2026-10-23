from .models import PolicyDecision, PolicyResult, ToolRequest


ALLOWED_TOOLS = {
    "read_logs",
    "read_config",
    "get_metrics",
    "compare_config",
    "check_dependencies",
    "validate_transactions",
    "rollback_config",
    "restart_service",
    "scale_service",
    "clear_cache",
    "modify_database",
    "escalate_to_human",
}


def evaluate_action(request: ToolRequest, client: str, incident_scope: set[str] | None = None) -> PolicyResult:
    """Authorize proposed actions using code, never by asking the LLM."""
    scope = incident_scope or {"checkout-service"}

    if request.tool not in ALLOWED_TOOLS:
        return PolicyResult(decision=PolicyDecision.BLOCKED, rule_id="POL-UNKNOWN-TOOL", reason="Tool is not in the approved tool contract.")

    if request.service not in scope:
        return PolicyResult(decision=PolicyDecision.BLOCKED, rule_id="POL-SERVICE-SCOPE", reason="Service is outside this incident's authorized scope.")

    if request.tool == "modify_database":
        return PolicyResult(decision=PolicyDecision.APPROVAL_REQUIRED, rule_id="POL-DB-APPROVAL", reason="Database mutations require explicit human approval.")

    if request.tool == "rollback_config":
        target = request.arguments.get("target_version")
        if target != "v_healthy":
            return PolicyResult(decision=PolicyDecision.BLOCKED, rule_id="POL-ROLLBACK-TARGET", reason="Rollback target must be the observed, approved healthy version.")

    if client.lower() == "client_b" and request.tool == "restart_service":
        return PolicyResult(decision=PolicyDecision.BLOCKED, rule_id="POL-CLIENT-B-RESTART", reason="Client B prohibits service restarts.")

    if client.lower() == "client_b" and request.tool == "rollback_config":
        return PolicyResult(decision=PolicyDecision.APPROVAL_REQUIRED, rule_id="POL-CLIENT-B-ROLLBACK", reason="Client B requires approval for configuration rollback.")

    if request.tool == "escalate_to_human":
        return PolicyResult(decision=PolicyDecision.ALLOWED, rule_id="POL-ESCALATE", reason="Escalation is a non-mutating safe action.")

    if request.tool in {
        "read_logs",
        "read_config",
        "get_metrics",
        "compare_config",
        "check_dependencies",
        "validate_transactions",
        "rollback_config",
        "restart_service",
        "scale_service",
        "clear_cache",
    }:
        return PolicyResult(decision=PolicyDecision.ALLOWED, rule_id="POL-DEFAULT-ALLOWLIST", reason="Action is explicitly allowed by the current tool policy.")

    return PolicyResult(decision=PolicyDecision.BLOCKED, rule_id="POL-DENY-BY-DEFAULT", reason="No policy explicitly permits this action.")
