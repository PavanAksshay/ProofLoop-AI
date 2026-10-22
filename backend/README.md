# ProofLoop AI Backend

## Run locally

From this directory:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
pytest
uvicorn app.main:app --reload
```

API docs: `http://127.0.0.1:8000/docs`

## Initial endpoints

- `GET /health`
- `GET /scenarios`
- `POST /incidents`

Example request body:

```json
{
  "scenario": "clean_recovery",
  "client": "client_a",
  "mode": "proofloop"
}
```

Supported initial scenario labels: `clean_recovery`, `false_green`, `stale_runbook`, and `hostile_log`.

## Important limitations

This is an early synthetic prototype. The current endpoint runs a bounded rule-based path and returns the event list in the response. It does not yet implement the live LLM provider, persistent event store, SSE stream, interactive approval endpoint, baseline benchmark, or frontend. Run the tests locally and treat their actual output as the source of truth.
