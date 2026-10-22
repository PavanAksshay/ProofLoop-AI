# ProofLoop AI

> Every fix must be authorized. Every recovery must be proven.

ProofLoop AI is a proposed AgentOps 2026 prototype for IT incident resolution. It investigates synthetic incidents, proposes remediation actions, enforces authorization through a deterministic policy gate, independently verifies service recovery, and records an evidence-backed audit trail.

## Project status

This repository has been created for the AgentOps 2026 hackathon. The working implementation will be developed during the event's permitted coding window, subject to organizer rules. Until those rules are confirmed, this repository contains project framing only; no working implementation is included.

## Planned core workflow

1. Ingest incident details, logs, metrics, runbooks, service topology, and client policy.
2. Investigate evidence and propose a remediation action.
3. Evaluate the action with a deterministic policy gate.
4. Execute only authorized actions in a synthetic service simulator, or pause for human approval, or block.
5. Run independent read-only verification.
6. Report `VERIFIED`, `UNVERIFIED`, `BLOCKED`, or `ESCALATED` with an audit trail.

## Planned technology

- Backend: Python, FastAPI, Uvicorn, Pydantic
- LLM: event-approved provider, with a rule-based fallback
- Frontend: React, TypeScript, Vite
- Live updates: Server-Sent Events (SSE)
- Testing: pytest
- Event log: JSONL

Provider access, network availability, allowed scaffolding, and judging requirements must be confirmed with the organizers.

## Team ownership

- **Sanjayram:** agent orchestration, policy gate, verifier, event flow, integration, and safety tests.
- **Pavan Aksshay:** synthetic simulator, controlled tools, fault scenarios, dashboard, and baseline runner.

The team will agree on shared contracts before implementation to minimize integration risk.

## Safety principles

- The LLM proposes; deterministic code authorizes and executes.
- The policy gate denies actions by default unless explicitly permitted.
- Logs, tickets, and runbooks are untrusted data, not authority.
- The verifier is read-only and does not trust the operator's success claims.
- Incident retries and tool actions are bounded; uncertain outcomes are escalated.
- Never commit API keys or credentials.

## Planned scenarios

- Clean recovery after a faulty configuration
- False-green health endpoint while checkout transactions fail
- Stale runbook contradicted by observed evidence
- Hostile log attempting to induce an unauthorized action

Additional tests may cover partial recovery, unavailable tools, repeated failures, conflicting evidence, approval workflows, and client-specific policy differences.

## Evaluation

A live benchmark will compare ProofLoop with a clearly described scripted baseline on the same synthetic scenarios. Metrics will be measured during execution; no performance results are claimed in advance.

## Repository workflow

Feature work should remain isolated on contributor branches and be integrated through review. Confirm the organizer's rules before committing any working implementation or starter code.
