# ProofLoop AI — Frontend Product & Architecture Audit

**Date**: October 2026  
**Repository**: `D:\ProofLoop-AI`  
**Base Commit**: `f3c89649d66aef78ccaa95e3fb1124776da061f4` (synchronized with `origin/main`)  
**Context**: Parallel frontend upgrade while Pavan develops the Phase 5 backend evaluation engine on `feat/phase5-dataset-evaluation`.

---

## 1. Existing Feature Inventory

| Area | Feature | Current State | Reusability / Notes |
| :--- | :--- | :--- | :--- |
| **01 Operations** | Scenario Launcher | Fully functional (`IncidentLauncher.tsx`). Allows selecting scenario (`clean_recovery`, `first_fix_fails`, `false_green`, etc.), client (`client_a`, `client_b`), mode (`proofloop`), and custom parameters. | **Keep & reuse**. Well-tested, connects to `POST /incidents/start`. |
| **01 Operations** | Safety Gate & Approvals Card | Functional inline card (`ApprovalCard.tsx`). Appears when active incident enters `PENDING_APPROVAL`. Allows one-click Approve or Reject with comments. | **Keep & reuse**. Integrates directly with `POST /incidents/{id}/approval`. |
| **01 Operations** | Verification Panel | Functional (`VerificationPanel.tsx`). Renders individual invariant checks (`passed: true/false`), observed payload details, and synthetic health status. | **Keep & reuse**. Demonstrates independent verifier rejection of false green. |
| **01 Operations** | Live Operations Governance Deck | Tabbed deck (`EventTimeline.tsx`, `ActionLifecycleTimeline.tsx`, `PolicyDecisionExplorer.tsx`). | **Keep & reuse**. 6-stage lifecycle visualization (Proposal → Policy → Approval → Execution → Verification → Outcome). |
| **02 Investigations** | Autonomous Cockpit | Functional (`InvestigationView.tsx`). Renders competing hypotheses matrix, confidence scores, evidence ledger, diagnostic telemetry, remediation attempts, replanning cycles, and invariant checks. | **Keep & enhance**. Add Topology & Root-Cause Explorer integration. |
| **03 Incidents** | Incident History Explorer | Functional list (`IncidentsView.tsx` & `IncidentHistory.tsx`). Supports selecting past runs, filtering by outcome/scenario, viewing details. | **Enhance**. Upgrade into Advanced Incident Explorer with multi-attribute filtering, sorting, pagination, and KPI summary. |
| **04 Approvals** | Governance & Audit Center | Functional (`ApprovalsView.tsx`). 3-tab layout: Pending Approvals queue, Historical Audit Decisions, and Enforced Policy Gate Matrix. | **Enhance**. Add evidence provenance tracking, export, and detailed invariant audit. |
| **05 Benchmark** | Synthetic Benchmark Lab | Functional (`BenchmarkView.tsx`). Triggers runs via `POST /benchmark`, fetches via `GET /benchmark/{id}`, displays comparison tables, trial metrics. | **Keep & enhance**. Structure clear boundary between synthetic simulator benchmarks and Phase 5 real-dataset evaluation. |
| **Global Shell** | Header & Navigation | Sharp technical header (`Header.tsx`) and drawer (`IncidentHistory.tsx`). View switching between 5 primary destinations. | **Enhance**. Add dedicated Analytics Dashboard and Topology exploration capabilities while preserving existing navigation contracts. |

---

## 2. Real API Contracts Available

The frontend communicates with a FastAPI backend (`http://127.0.0.1:8000` / `8001`) with the following validated endpoints:

1. **`GET /health`**
   - Returns: `{ "status": "ok", "configured_mode": "fallback"|"gemini", "implementation": "synthetic-prototype" }`
   - Purpose: Backend heartbeat and configured LLM mode.

2. **`GET /scenarios`**
   - Returns: `{ "scenarios": [...], "clients": ["client_a", "client_b"], "modes": ["proofloop"] }`
   - Purpose: Scenario options for simulation launcher.

3. **`GET /incidents?limit=N`** (1 <= N <= 200)
   - Returns: `{ "incidents": [ { "incident_id": string, "scenario": string, "client": string, "outcome": Outcome, "summary": string, "mode": string, "created_at": string, "updated_at": string } ] }`
   - Purpose: Historical list of executed incidents.

4. **`GET /incidents/{incident_id}`**
   - Returns: Full `IncidentResponse` with `events`, `investigation_state`, `outcome`, `summary`.

5. **`GET /incidents/{incident_id}/investigation`**
   - Returns: `InvestigationState` (`hypotheses`, `evidence`, `diagnostics_performed`, `remediation_history`, `budget`, `current_diagnosis`, `replanning_cycle`, `escalation_reason`).

6. **`GET /incidents/{incident_id}/events?after=N`** (SSE)
   - Streams `text/event-stream` with numeric sequence IDs, event types, and payloads (`incident_opened`, `action_proposed`, `policy_decision`, `approval_requested`, `tool_executed`, `verification_check`, `outcome`).

7. **`POST /incidents/start`**
   - Body: `{ "scenario": string, "client": string, "mode": string, "custom_params"?: object }`
   - Returns: `{ "incident_id": string, "outcome": "RUNNING", "events_url": string, "incident_url": string }` (HTTP 202).

8. **`POST /incidents/{incident_id}/approval`**
   - Body: `{ "decision": "approve"|"deny", "approver_id": string, "comment"?: string }`
   - Returns: Updated `IncidentResponse`.

9. **`POST /benchmark` & `GET /benchmark/{run_id}`**
   - Triggers synthetic benchmark and polls execution status and metric results.

---

## 3. Missing Contracts & Unsupported Capabilities

The following product capabilities are **not** supported by native backend endpoints:

1. **Dedicated Analytics Aggregations Endpoint (`GET /analytics/summary`)**:
   - **Gap**: There is no server-side endpoint calculating historical false-success rate, mean time to recovery (MTTR), or policy violation aggregates across all historical incidents. Furthermore, the `GET /incidents` summary endpoint does not expose per-incident verification check records (`remediation_history[].verification_checks`) or SSE policy decision history.
   - **Frontend Resolution & Integrity Rules**:
     - `falseSuccessRate` is explicitly set to `null` with a clear explanation (`"Cannot be computed from incident summary list..."`). It is displayed as `UNAVAILABLE` rather than fabricating `0.0%`.
     - `policyViolationRate` is explicitly set to `null` with an explanation because decision events are only streamed via SSE. It is displayed as `UNAVAILABLE` rather than fabricating `0.0%`.
     - MTTR is computed exclusively for `VERIFIED` incidents with valid distinct timestamps where `updated_at > created_at`. Reversed, zero-duration, or unverified records are excluded.
   - **Contract Recommendation for Backend**: `GET /api/v1/analytics/overview` returning pre-calculated windowed metrics with explicit numerators and denominators.

2. **Dedicated Service Topology Endpoint (`GET /topology` or `GET /services/graph`)**:
   - **Gap**: The backend does not maintain an explicit static service dependency graph API.
   - **Frontend Resolution & Integrity Rules**:
     - Dynamic synthesis builds nodes only from direct evidence, diagnostic execution, or remediation targets.
     - No default/standard nodes (e.g. `edge-gateway`, `checkout-service`) are unconditionally injected.
     - **Co-occurrence alone never creates an edge**: Unrelated co-occurring services produce zero dependency links.
     - Links are created only when specific evidence or an explicit hypothesis supports cross-service interaction.
     - Network protocols are never fabricated (`protocol: null`).
     - A successful diagnostic probe does not assert service health (status stays `unknown`).
     - Service health is marked `healthy` only upon independent recovery verification (`verification_passed === true`).
     - If an incident has no service telemetry, an honest `hasSufficientTelemetry: false` state is rendered.
   - **Contract Recommendation for Backend**: `GET /incidents/{id}/topology` returning verified nodes and observed network traces.

3. **Phase 5 Real-Dataset Evaluation Endpoint**:
   - **Gap**: Pavan is currently writing this engine on `feat/phase5-dataset-evaluation`.
   - **Frontend Resolution**: Built a cleanly isolated interface (`BenchmarkLab`) with a dedicated tab for "Real Dataset Evaluation (Phase 5)" displaying documented integration points, typed schemas, and clear separation from synthetic simulator trials. A preview fixture is provided with an explicit development-only banner.

---

## 4. Components Implemented & Reused

- **`IncidentLauncher.tsx`**: Retain as core scenario simulation trigger.
- **`ApprovalCard.tsx`**: Retain for atomic safety gate approvals.
- **`VerificationPanel.tsx`**: Retain as primary proof-of-recovery evaluator.
- **`EventTimeline.tsx`**: Retain; formatted event summaries with Phase 1–4 governance.
- **`ActionLifecycleTimeline.tsx`**: 6-stage lifecycle tracing (`Proposal → Policy → Approval → Execution → Verification → Outcome`).
- **`PolicyDecisionExplorer.tsx`**: Policy audit and rule inspection deck.
- **`InvestigationView.tsx`**: Autonomous Cockpit with hypothesis matrix, evidence ledger, and integrated Service Topology Explorer.
- **`ServiceTopologyExplorer.tsx`**: Dynamic microservice topology visualization with evidence-backed dependency links, provenance tags, and honest unavailable state.
- **`AnalyticsDashboard.tsx`**: Operational Analytics Dashboard with transparent metric derivation and explicit unavailable states for unmeasured metrics.
- **`BenchmarkView.tsx`**: Dual-mode evaluation lab separating synthetic simulator benchmarks from Phase 5 real-dataset evaluation preview.
- **`IncidentsView.tsx`**: Advanced Incident Explorer with sorting, search, multi-field filtering, and incident inspection.
- **`ApprovalsView.tsx`**: Governance & Audit Center with pending approval queue and policy rule matrix.

---

## 5. Proposed Navigation & Product Architecture

To satisfy all six product areas while preserving full backwards compatibility with existing tests and workflows, the product architecture will be structured as:

```
PROOFLOOP AI (Shell)
├── Header & Persistent Sidebar Navigation
│   ├── // 00 ANALYTICS (Feature 1: Incident Analytics Dashboard)
│   ├── // 01 OPERATIONS (Feature 3: Live Agent Activity Center & Command Deck)
│   ├── // 02 INVESTIGATIONS (Feature 3 & 4: Cockpit & Service Topology Explorer)
│   ├── // 03 INCIDENTS (Feature 2: Advanced Incident Explorer)
│   ├── // 04 GOVERNANCE & APPROVALS (Feature 6: Governance & Audit Center)
│   └── // 05 BENCHMARK (Feature 5: Benchmark & Evaluation Lab)
```

Each product area is fully functional, backed by typed data clients, and communicates the core thesis:
`Observe → Diagnose → Policy Check → Act → Verify → Replan → Recover or Escalate`.
