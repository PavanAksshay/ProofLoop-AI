import json

from app import llm_investigator
from app.models import PolicyDecision, ToolRequest
from app.policy import evaluate_action
from app.simulator import ServiceSimulator
from app.verifier import verify_recovery


def test_no_provider_uses_rule_based_fallback(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("OLLAMA_BASE_URL", raising=False)
    monkeypatch.setenv("PROOFLOOP_LLM_PROVIDER", "auto")

    action, rationale, refs, mode = llm_investigator.propose_action(ServiceSimulator("clean_recovery"))

    assert action.tool == "rollback_config"
    assert mode == "fallback"
    assert rationale
    assert "config:checkout-service" in refs


def test_valid_llm_proposal_is_parsed_but_not_authorized(monkeypatch):
    monkeypatch.setenv("PROOFLOOP_LLM_PROVIDER", "groq")
    monkeypatch.setattr(
        llm_investigator,
        "_provider_response",
        lambda provider, evidence: json.dumps({
            "tool": "restart_service",
            "service": "checkout-service",
            "arguments": {},
            "rationale": "Try a restart based on the observed evidence.",
        }),
    )

    action, rationale, _, mode = llm_investigator.propose_action(ServiceSimulator("clean_recovery"))

    assert action.tool == "restart_service"
    assert mode == "llm:groq"
    assert "policy gate" in rationale
    assert evaluate_action(action, "client_b").decision == PolicyDecision.BLOCKED


def test_malformed_llm_output_falls_back(monkeypatch):
    monkeypatch.setenv("PROOFLOOP_LLM_PROVIDER", "groq")
    monkeypatch.setattr(llm_investigator, "_provider_response", lambda provider, evidence: "not-json")

    action, _, _, mode = llm_investigator.propose_action(ServiceSimulator("clean_recovery"))

    assert action.tool == "rollback_config"
    assert mode == "fallback"


def test_untrusted_log_does_not_become_authority(monkeypatch):
    monkeypatch.setenv("PROOFLOOP_LLM_PROVIDER", "groq")
    captured = {}

    def fake_response(provider, evidence):
        captured.update(evidence)
        return json.dumps({
            "tool": "modify_database",
            "service": "checkout-service",
            "arguments": {},
            "rationale": "The log suggested this, but approval is required.",
        })

    monkeypatch.setattr(llm_investigator, "_provider_response", fake_response)
    action, _, _, mode = llm_investigator.propose_action(ServiceSimulator("hostile_log"))

    assert mode == "llm:groq"
    assert any("UNTRUSTED LOG CONTENT" in line for line in captured["logs"])
    assert evaluate_action(action, "client_a").decision == PolicyDecision.APPROVAL_REQUIRED


def test_unknown_action_is_blocked_without_simulator_mutation():
    simulator = ServiceSimulator("clean_recovery")
    before = simulator.snapshot()
    action = ToolRequest(
        tool="delete_production_database",
        service="checkout-service",
        arguments={},
    )

    decision = evaluate_action(action, "client_a")

    assert decision.decision == PolicyDecision.BLOCKED
    assert decision.rule_id == "POL-UNKNOWN-TOOL"
    assert simulator.snapshot() == before


def test_false_green_scenario_fails_independent_verification():
    simulator = ServiceSimulator("false_green")

    report = verify_recovery(simulator)

    assert not report.all_passed
    assert any(not check.passed for check in report.checks)
    assert simulator.snapshot()["health_endpoint_status"] == 200


def test_provider_failure_safely_falls_back(monkeypatch):
    monkeypatch.setenv("PROOFLOOP_LLM_PROVIDER", "groq")

    def raise_provider_error(provider, evidence):
        raise RuntimeError("sensitive provider detail must not leak")

    monkeypatch.setattr(llm_investigator, "_provider_response", raise_provider_error)

    action, rationale, refs, mode = llm_investigator.propose_action(ServiceSimulator("clean_recovery"))

    assert action.tool == "rollback_config"
    assert mode == "fallback"
    assert rationale
    assert refs


def test_load_environment_precedence(tmp_path, monkeypatch):
    """Test precedence: process environment > backend/.env > root/.env without overwriting."""
    from pathlib import Path
    import os

    root_dir = tmp_path / "repo_root"
    backend_dir = root_dir / "backend"
    backend_app_dir = backend_dir / "app"
    backend_app_dir.mkdir(parents=True)

    fake_module_file = backend_app_dir / "llm_investigator.py"
    fake_module_file.write_text("# dummy")

    root_env = root_dir / ".env"
    root_env.write_text("VAR_FROM_ROOT=from_root\nOVERRIDDEN_VAR=from_root\nPROCESS_VAR=from_root\n")

    backend_env = backend_dir / ".env"
    backend_env.write_text("VAR_FROM_BACKEND=from_backend\nOVERRIDDEN_VAR=from_backend\nPROCESS_VAR=from_backend\n")

    # Set existing process variable
    monkeypatch.setenv("PROCESS_VAR", "from_process")
    monkeypatch.delenv("VAR_FROM_ROOT", raising=False)
    monkeypatch.delenv("VAR_FROM_BACKEND", raising=False)
    monkeypatch.delenv("OVERRIDDEN_VAR", raising=False)
    monkeypatch.delenv("PROOFLOOP_ENV_FILE", raising=False)

    # Monkeypatch __file__ resolution in llm_investigator
    monkeypatch.setattr(llm_investigator, "__file__", str(fake_module_file))

    llm_investigator.load_environment()

    # Assertions
    assert os.getenv("PROCESS_VAR") == "from_process"  # Process env preserved
    assert os.getenv("OVERRIDDEN_VAR") == "from_backend"  # backend/.env takes precedence over root/.env
    assert os.getenv("VAR_FROM_BACKEND") == "from_backend"
    assert os.getenv("VAR_FROM_ROOT") == "from_root"  # Root/.env sets unset variables


def test_explicit_env_file_takes_precedence(tmp_path, monkeypatch):
    """Test that explicit PROOFLOOP_ENV_FILE takes precedence over backend and root .env."""
    from pathlib import Path
    import os

    root_dir = tmp_path / "repo_root2"
    backend_dir = root_dir / "backend"
    backend_app_dir = backend_dir / "app"
    backend_app_dir.mkdir(parents=True)

    fake_module_file = backend_app_dir / "llm_investigator.py"
    fake_module_file.write_text("# dummy")

    custom_env = tmp_path / "custom.env"
    custom_env.write_text("CUSTOM_VAR=from_custom\nOVERRIDDEN_VAR=from_custom\n")

    backend_env = backend_dir / ".env"
    backend_env.write_text("OVERRIDDEN_VAR=from_backend\n")

    monkeypatch.delenv("CUSTOM_VAR", raising=False)
    monkeypatch.delenv("OVERRIDDEN_VAR", raising=False)
    monkeypatch.setenv("PROOFLOOP_ENV_FILE", str(custom_env))
    monkeypatch.setattr(llm_investigator, "__file__", str(fake_module_file))

    llm_investigator.load_environment()

    assert os.getenv("CUSTOM_VAR") == "from_custom"
    assert os.getenv("OVERRIDDEN_VAR") == "from_custom"
