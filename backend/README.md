# ProofLoop AI Backend

## Run locally

From this directory:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
pytest -v
uvicorn app.main:app --reload
```

API docs: `http://127.0.0.1:8000/docs`

## Endpoints

- `GET /health`
- `GET /scenarios`
- `POST /incidents` — synchronous run, useful for debugging
- `POST /incidents/start` — start a background run and return an incident ID immediately
- `GET /incidents` — list recent incidents
- `GET /incidents/{incident_id}` — retrieve persisted incident metadata and events
- `GET /incidents/{incident_id}/events` — Server-Sent Events (SSE), with optional `?after=<sequence>` resume cursor
- `POST /incidents/{incident_id}/approval` — submit an explicit `approve` or `deny` decision

## Optional LLM investigator

The investigator can use Groq or a local Ollama model, while retaining the deterministic rule-based planner as a safe fallback. No API key is required to run the project.

1. Copy `.env.example` to `.env` in this directory and configure the provider.
2. For Groq, set `PROOFLOOP_LLM_PROVIDER=groq` and add your `GROQ_API_KEY`.
3. For local Ollama, start Ollama, pull a compatible chat model, and set `PROOFLOOP_LLM_PROVIDER=ollama` plus `OLLAMA_MODEL`.
4. Use `PROOFLOOP_LLM_PROVIDER=fallback` to disable provider calls.

The default `auto` mode selects Groq when `GROQ_API_KEY` is present, selects Ollama when `OLLAMA_BASE_URL` is explicitly configured, and otherwise uses fallback. Provider failures, timeouts, and invalid model output also fall back to the deterministic planner. The API response and `action_proposed` event identify the selected planning mode (for example, `llm:groq` or `fallback`).

**Security boundary:** the LLM only proposes an action. Every proposal still passes through `evaluate_action`; blocked actions never execute, and approval-required actions wait for a human decision. The model is given bounded evidence and is instructed to treat logs as untrusted data. Independent verification remains the only way to report `VERIFIED`. Never put credentials in prompts or commit your real `.env` file.

The provider tests use a mocked response and do not require network access or API credentials.

## Live event flow

Call `POST /incidents/start` with:

```json
{
  "scenario": "clean_recovery",
  "client": "client_a",
  "mode": "proofloop"
}
```

The response includes `incident_id`, `events_url`, and `incident_url`. Open the events URL as an SSE stream to receive ordered events as the worker appends them. The stream replays persisted events and supports reconnecting with the last sequence in `?after=`.

## Approval workflow

Start an incident using Client B, whose policy requires approval for configuration rollback. The synchronous `POST /incidents` endpoint should return `PENDING_APPROVAL` and include an `approval_requested` event. No `tool_executed` event should exist yet.

Submit to `POST /incidents/{incident_id}/approval`:

```json
{
  "decision": "approve",
  "approver_id": "demo-operator",
  "comment": "Approved for the controlled demo"
}
```

Approval executes the exact action stored by the application and triggers independent verification. Use `"decision": "deny"` to reject the action without executing it.

Pending approval data—including the exact tool request, client, scenario and simulator snapshot—is now stored in SQLite. On process restart, the pending action can be reconstructed from this saved state. Approval decisions are claimed atomically in SQLite so two concurrent requests cannot both win. An interrupted claim is returned to pending at startup for the single-worker local prototype.

## Persistence and security limitations

- Incident metadata, event history and pending approval execution context are stored in SQLite at `backend/proofloop.db` by default. Set `PROOFLOOP_DB_PATH` to choose another path. The local database is git-ignored.
- This recovery behavior is designed for the single-worker synthetic prototype. Do not run multiple application workers with startup claim recovery enabled. Real infrastructure actions need stronger idempotency, leases, durable execution receipts and reconciliation before retrying an interrupted operation.
- The current `approver_id` is an audit label, **not authentication**. The approval endpoint is for a local, controlled demo only and must not be exposed to an untrusted network. Production use requires authenticated identity, authorization/role checks, CSRF or equivalent protections where applicable, durable audit controls, and concurrency-safe approval handling.
- The LLM investigator is optional and provider-configurable; the deterministic rule-based investigator remains the fallback. The current implementation is for the synthetic prototype and has not been hardened for production use.
- Benchmarking and the React dashboard remain planned.
- This is a synthetic prototype, not a production IT operations tool.
