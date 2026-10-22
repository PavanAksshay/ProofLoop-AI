# Dashboard Integration Contract

This document is the integration boundary between the ProofLoop AI backend and the React dashboard/simulator.

## Base URL and runtime

- Local API: `http://127.0.0.1:8000`
- Interactive API documentation: `/docs`
- The implementation is a **synthetic prototype**. It does not operate real infrastructure.
- Run the backend from `backend/` with the project environment activated. Configure `PROOFLOOP_LLM_PROVIDER=fallback` for deterministic demos and tests.

## Read endpoints

### `GET /health`

Returns `status`, `configured_mode`, and `implementation`. Treat this as backend availability, not proof that a simulated service is healthy.

### `GET /scenarios`

Returns supported scenario names, clients, and modes. Use this response to populate selectors rather than hard-coding the options.

### `GET /incidents?limit=50`

Returns `{ "incidents": [...] }`. The limit is 1–200. Each summary includes incident ID, scenario, client, outcome, summary, mode, and timestamps.

### `GET /incidents/{incident_id}`

Returns the incident response with metadata and its persisted event history. Unknown IDs return HTTP 404.

### `GET /incidents/{incident_id}/events?after=0`

Server-Sent Events (SSE) replay. The optional `after` value is an event sequence cursor, not an event ID. Each message contains:
- `id`: persisted sequence number
- `event`: event type
- `data`: JSON event with `sequence`, `event_id`, `incident_id`, `timestamp`, `type`, `actor`, `payload`, and `evidence_refs`

Reconnect using the last received numeric sequence as `after`. Events are append-only and can be replayed. A stream closes after the incident reaches a final outcome and all available events have been sent.

## Start and approval flow

### `POST /incidents/start`

Request:
```json
{
  "scenario": "clean_recovery",
  "client": "client_a",
  "mode": "proofloop"
}
```

Returns HTTP 202 with `incident_id`, initial `outcome`, `events_url`, and `incident_url`. Open the event stream and poll/read the incident endpoint for current status.

### `POST /incidents`

Runs a scenario synchronously and returns the complete `IncidentResponse`. Useful for the demo's simple “run now” interaction.

### `POST /incidents/{incident_id}/approval`

Request:
```json
{
  "decision": "approve",
  "approver_id": "demo-reviewer",
  "comment": "Reviewed the proposed change"
}
```

`decision` must be `approve` or `deny`. The UI should show the exact proposed tool, service, arguments, policy rule, and reason from the `approval_requested` event before enabling the decision controls. Approval is not authentication in this prototype; `approver_id` is an audit label only. A rejected or already-resolved decision can return HTTP 409, and missing incidents/approvals can return HTTP 404.

## Event types the dashboard should recognize

- `incident_opened`, `evidence_collected`: run started and evidence gathered.
- `injection_detected`: instruction-like content was found in untrusted logs; it must remain data, not a command.
- `action_proposed`: investigator proposal; **not authorization**.
- `policy_decision`: deterministic gate decision (`ALLOWED`, `APPROVAL_REQUIRED`, or `BLOCKED`).
- `approval_requested`, `human_approval_decision`, `approval_rejected_by_policy`: human approval lifecycle.
- `tool_executed`: simulator reports an execution result. Display only as synthetic execution.
- `verification_check`, `verification_result`: independent recovery checks; the basic health endpoint alone is insufficient.
- `outcome`: final state, typically `VERIFIED`, `ESCALATED`, or `BLOCKED`.
- `worker_error`: background worker failed; the message is intentionally generic.

## Demo acceptance checklist

1. Populate scenario/client selectors from `GET /scenarios`.
2. Start a run and show live/replayed events with actor, type, and payload.
3. Visually distinguish proposal from policy authorization.
4. If approval is pending, display the proposed action and policy reason; no execution should appear before approval.
5. Show each verifier check and the final outcome. Never mark recovery as verified solely from a green health endpoint.
6. Handle 404/409/422 responses and reconnect SSE with the last numeric sequence.
7. Label all execution and metrics as synthetic/simulated.
