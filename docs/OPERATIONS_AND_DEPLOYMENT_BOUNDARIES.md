# ProofLoop AI: Deployment Boundaries and Operations Architecture

## 1. System Overview & Synthetic Simulator Boundary

ProofLoop AI is implemented as a synthetic-only reliability prototype designed to demonstrate governance-gated remediation, evidence-driven adaptive recovery, and independent recovery verification.

### 1.1 Synthetic Sandbox Isolation
- **No Real Infrastructure Mutation**: The backend interacts exclusively with in-memory `ServiceSimulator` instances. No cloud provider APIs, container orchestrators (Kubernetes/Docker), databases, or network devices are called.
- **Controlled Invariant Probing**: Recovery verification tests three explicit invariants directly against simulated service state:
  1. `synthetic_checkout`: Evaluates transaction throughput and checkout failure counts.
  2. `error_rate_window`: Evaluates sliding-window HTTP error rates ($\le 5\%$).
  3. `configuration_and_dependencies`: Evaluates active config version against `v_healthy`, verifies downstream dependency health, and ensures the service process is running.
- **Safe Evaluation Boundary**: A "green" HTTP health check (HTTP 200 OK) is never treated as recovery proof. In scenarios like `false_green` and `misleading_health_signal`, internal transaction invariants fail independently, forcing safe escalation or replanning.

---

## 2. Persistence and Process Architecture

### 2.1 SQLite Concurrency & Transaction Guarantees
- **Storage Layer**: Incidents, events, pending approvals, investigation states, and benchmark results are persisted in local SQLite via WAL (Write-Ahead Logging) mode.
- **Immediate Transactions for Claim Concurrency**:
  - Human approvals use `BEGIN IMMEDIATE` transactions to prevent duplicate execution during operator races.
  - When an approval is requested, the pending record is stored with `status = 'pending'`.
  - The first worker to call `claim_pending_approval` transitions the status to `'processing'`.
  - Any concurrent worker receives `None` and is rejected with an HTTP 409 Conflict.
- **Process Limitations**:
  - SQLite is single-node and local to the file system (`backend/proofloop.db`).
  - SQLite transactions do not provide a distributed lock across multiple independent nodes or containers.
  - Multi-process or cluster deployments require migrating to PostgreSQL with row-level locking (`SELECT ... FOR UPDATE`) or Redis-based distributed locking (e.g., Redlock).

### 2.2 Worker Lifecycle & In-Memory Incident Coordination
- **Single-Worker Execution**: Background tasks run via FastAPI's `BackgroundTasks` in the same Python process.
- **State Rehydration**:
  - If the server process restarts while an approval is pending, `recover_interrupted_approval_claims()` resets any orphaned `'processing'` claims back to `'pending'` on startup.
  - The simulator state is snapshot-serialized into SQLite before pausing, allowing seamless rehydration when an operator submits a decision post-restart.
- **SSE Stream Invalidation**:
  - SSE connections are bound to the specific server process. If the process terminates, connected clients must reconnect using `GET /incidents/{id}/events?after=<last_sequence>`.
  - Replay is guaranteed because all events are stored with monotonic numeric sequence IDs.

---

## 3. Configuration and Environment Variables

The backend relies on the following environment variables:

| Variable | Default Value | Description | Production Requirement |
| :--- | :--- | :--- | :--- |
| `PROOFLOOP_LLM_PROVIDER` | `fallback` | Controls investigation engine mode: `fallback` (deterministic rule-based) or `openai` / `anthropic` (LLM-assisted). | Set to `fallback` in test/demo suites for 100% deterministic reproducibility. |
| `PROOFLOOP_CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated list of allowed browser origins for CORS. | Restrict strictly to authorized frontend origins. |
| `OPENAI_API_KEY` | *(None / Placeholder)* | API key for LLM investigation consultation if `PROOFLOOP_LLM_PROVIDER=openai`. | Must never be committed. Ingest via secret manager (AWS Secrets Manager, Vault). |
| `ANTHROPIC_API_KEY` | *(None / Placeholder)* | API key if `PROOFLOOP_LLM_PROVIDER=anthropic`. | Ingest via secret manager. |

### 3.1 Secret Handling Rules
- Example environment files (`.env.example`) must contain placeholder tokens only (e.g. `sk-test-placeholder`).
- Loggers strip and sanitize raw credentials. Error responses never disclose stack traces or system environment variables to API consumers.

---

## 4. Operational Procedures

### 4.1 Startup Sequence
1. Activate virtual environment:
   ```bash
   cd backend && source .venv/bin/activate
   ```
2. Start Uvicorn ASGI server:
   ```bash
   uvicorn app.main:app --host 127.0.0.1 --port 8000
   ```
3. FastAPI lifespan executes:
   - `initialize_store()`: Verifies SQLite tables and indices exist.
   - `recover_interrupted_approval_claims()`: Recovers interrupted approvals.
4. Verify server health:
   ```bash
   curl http://127.0.0.1:8000/health
   # Expected: {"status": "ok", "configured_mode": "fallback", "implementation": "synthetic-prototype"}
   ```

### 4.2 Benchmark Execution
To run reproducible empirical benchmarks comparing scripted baselines against ProofLoop AI:
```bash
python -m benchmark.cli \
  --scenarios clean_recovery false_green stale_runbook hostile_log first_fix_fails partial_recovery misleading_health_signal unprovable_recovery \
  --trials 3 \
  --seed 42 \
  --client client_a
```
Results are output to stdout and serialized to `benchmark/results/latest.json`.

---

## 5. Migration Roadmap: Real Infrastructure & Multi-Node Scale

Before ProofLoop AI can manage real-world production infrastructure or run in a multi-worker cluster, the following architectural boundaries must be upgraded:

```
[Current Prototype]
FastAPI In-Memory BackgroundTasks -> Local SQLite WAL -> Synthetic ServiceSimulator

[Production Architecture]
FastAPI Cluster -> Celery / Temporal Workers -> PostgreSQL (Durable Audit) -> Real Tool Adapters (K8s/AWS/GCP)
                        ^                             |                                  |
                        |                             v                                  v
                  Redis / Kafka           Role-Based Human Approvals         Independent Telemetry Verifiers
                  (Event Pub/Sub)            (SSO / Dual-Custody)                 (Datadog / Prometheus)
```

### 5.1 What Must Change for Multi-Node Deployment
1. **Distributed Queue & Worker Coordination**:
   - Replace in-process `BackgroundTasks` with a durable distributed task queue (e.g., Celery with Redis/RabbitMQ, or Temporal/Cadence).
   - Tasks must be idempotent and tracked with unique deduplication IDs.
2. **Durable Shared Database**:
   - Migrate from local SQLite to PostgreSQL.
   - Enforce row-level locking for pending approval claims (`SELECT ... FOR UPDATE SKIP LOCKED`).
3. **Distributed Event Streaming**:
   - Replace local SQLite polling in SSE with Redis Pub/Sub or Kafka consumer groups to support fan-out across multiple web gateway nodes.

### 5.2 What Must Change Before Connecting Real Infrastructure
1. **Explicit Tool Adapters with Least-Privilege Sandboxing**:
   - Implement typed adapters for Kubernetes (`kubectl rollback`), cloud providers (AWS/GCP APIs), and databases.
   - Execute mutating commands in ephemeral containers with dropped Linux capabilities and network security policies.
2. **Independent Verifiers Connected to External Metrics**:
   - Replace in-memory simulator inspections with independent queries against production monitoring systems (Prometheus, Datadog, CloudWatch).
   - Verifiers must query external metrics directly through read-only credentials, completely segregated from the agent's execution context.
3. **Dual-Custody Human Approval**:
   - Integrate with corporate SSO (OIDC/SAML) to verify operator identity and permissions.
   - Enforce dual-custody ("two-man rule") for high-risk actions (e.g. database schema mutations, regional traffic drains).
