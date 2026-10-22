import json

from app import llm_investigator
from app.models import PolicyDecision
from app.policy import evaluate_action
from app.simulator import ServiceSimulator


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
    # The proposal is still subject to client-specific deterministic policy.
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
