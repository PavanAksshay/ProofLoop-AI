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
- `POST /incidents` — open an incident and run the bounded fallback workflow
- `GET /incidents/{incident_id}` — retrieve a pending or completed incident in the current process
- `POST /incidents/{incident_id}/approval` — submit an explicit `approve` or `deny` decision

## Try the approval workflow

Start an incident using Client B, whose policy requires approval for configuration rollback:

```json
{
  "scenario": "clean_recovery",
  "client": "client_b",
  "mode": "proofloop"
}
```

The response should have outcome `PENDING_APPROVAL` and include an `approval_requested` event. No `tool_executed` event should exist yet.

Copy the returned `incident_id`, then submit the decision:

```json
{
  "decision": "approve",
  "approver_id": "demo-operator",
  "comment": "Approved for the controlled demo"
}
```

Send that body to `POST /incidents/{incident_id}/approval`. Approval executes the exact stored action and triggers independent verification. Use `"decision": "deny"` to reject the action without executing it.

## Prototype limitations and security note

- Pending and completed incident state is held in process memory. Restarting the server clears it; this is not durable storage.
- The current `approver_id` is an audit label, **not authentication**. The approval endpoint is for a local, controlled demo only and must not be exposed to an untrusted network. Production use requires authenticated identity, authorization/role checks, CSRF or equivalent request protections where applicable, durable state, and concurrency-safe approval handling.
- The current investigator is rule-based fallback; live LLM integration is not implemented.
- SSE, baseline benchmarking and the React dashboard are still planned.
- This is a synthetic prototype, not a production IT operations tool.
