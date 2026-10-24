# ProofLoop AI — Phase 5 Frontend Integration Contract & Specification

**Date**: October 2026  
**Status**: PROPOSED INTEGRATION SPECIFICATION  
**Author**: Frontend Engineering Lead  
**Backend Lead**: Pavan Aksshay (`feat/phase5-dataset-evaluation`)

---

## 1. Context & Objective

Pavan is implementing the Phase 5 backend evaluation engine to benchmark autonomous diagnosis on real-world datasets (e.g. Cloud-OpsBench, synthetic distributed microservice failure traces).

The frontend must provide a dedicated evaluation lab that:
1. Clearly distinguishes **Synthetic Simulator Recovery Trials** from **Real-Dataset Diagnosis Evaluation**.
2. Does **not** conflate different metrics (e.g. recovery rate vs. root-cause diagnosis top-1 accuracy).
3. Provides a clean, typed contract ready to ingest Pavan's evaluation outputs once merged.
4. Prevents fabricated or placeholder data from contaminating production evaluation displays.

---

## 2. Existing Benchmark Architecture (Synthetic Simulator)

### Current API Contract
- **Trigger**: `POST /benchmark` with payload:
  ```json
  {
    "scenarios": ["clean_recovery", "first_fix_fails", "false_green", "stale_runbook"],
    "client": "client_a",
    "trials": 3,
    "seed": 42
  }
  ```
- **Poll**: `GET /benchmark/{run_id}` returning `{ "run_id": string, "status": "running"|"completed"|"failed", "result": BenchmarkResult }`.
- **Result Schema (`BenchmarkResult`)**:
  - `metrics.proofloop` vs `metrics.baseline`:
    - `verified_recovery_rate`: MetricRecord (`value`, `numerator`, `denominator`, `formula`)
    - `false_success_rate`: MetricRecord
    - `unauthorized_mutations`: MetricRecord
    - `avg_tool_calls`: MetricRecord
    - `avg_time_ms`: MetricRecord
    - `escalation_correctness`: MetricRecord
  - `per_scenario`: Breakdown per scenario name.
  - `raw_trials`: Individual trial execution details.

---

## 3. Proposed Phase 5 Real-Dataset Evaluation Contract

The dataset evaluation differs fundamentally from simulator runs because the agent diagnoses offline or historical incidents rather than actively executing mutations on a live mock environment.

### Proposed Endpoint: `GET /benchmark/dataset-evaluations`
Returns a list of completed dataset evaluation runs:
```json
{
  "evaluations": [
    {
      "evaluation_id": "eval-cloudops-20261024-001",
      "dataset_name": "Cloud-OpsBench-v1",
      "dataset_version": "1.2.0",
      "dataset_provenance": "HuggingFace/cloudops-bench-curated",
      "total_cases": 120,
      "timestamp": "2026-10-24T12:00:00Z",
      "evaluator_version": "0.5.0",
      "status": "completed"
    }
  ]
}
```

### Proposed Endpoint: `GET /benchmark/dataset-evaluations/{evaluation_id}`
Returns granular evaluation metrics and per-case results:
```json
{
  "evaluation_id": "eval-cloudops-20261024-001",
  "dataset_metadata": {
    "name": "Cloud-OpsBench",
    "version": "1.2.0",
    "license": "Apache-2.0",
    "split": "test",
    "case_count": 120
  },
  "aggregate_metrics": {
    "top1_diagnosis_accuracy": {
      "value": 0.842,
      "numerator": 101,
      "denominator": 120,
      "description": "Top-1 proposed hypothesis matches ground truth root cause category"
    },
    "top3_diagnosis_accuracy": {
      "value": 0.958,
      "numerator": 115,
      "denominator": 120,
      "description": "Ground truth root cause is present within top-3 ranked hypotheses"
    },
    "mean_diagnostic_steps": {
      "value": 3.4,
      "description": "Average number of diagnostic tool queries needed to reach diagnosis"
    },
    "diagnostic_efficiency_ratio": {
      "value": 0.78,
      "description": "Proportion of diagnostics that yielded informative evidence"
    },
    "hallucination_or_unsupported_rate": {
      "value": 0.00,
      "description": "Zero-tolerance: hypotheses asserted with high confidence without supporting evidence"
    }
  },
  "category_breakdown": {
    "configuration_error": { "cases": 35, "accuracy": 0.914 },
    "resource_exhaustion": { "cases": 40, "accuracy": 0.825 },
    "network_partition": { "cases": 25, "accuracy": 0.800 },
    "dependency_failure": { "cases": 20, "accuracy": 0.850 }
  },
  "cases": [
    {
      "case_id": "case-042",
      "title": "Postgres Connection Starvation under Surge",
      "ground_truth_category": "resource_exhaustion",
      "predicted_category": "resource_exhaustion",
      "predicted_hypothesis_title": "Database connection pool saturated by leaked handles",
      "confidence": 0.94,
      "diagnostics_called": ["inspect_config", "probe_connection_pool"],
      "match": true,
      "explanation": "Agent correlated active connection metrics with timeout logs."
    }
  ]
}
```

---

## 4. Distinguishing Real Runs from Development Fixtures

To ensure audit integrity:
1. **Production View**:
   - Only queries `GET /benchmark/dataset-evaluations` and `GET /benchmark/dataset-evaluations/{id}`.
   - If the endpoint returns HTTP 404 or connection error, the UI displays:
     `"Phase 5 Real-Dataset Evaluation Engine: Backend Under Development by Pavan."`
     with exact schema requirements and instructions.
2. **Fixture Mode**:
   - Development fixtures are strictly isolated in a development-only preview panel with explicit visual labeling: `[PREVIEW FIXTURE — NOT PRODUCTION EVALUATION DATA]`.
   - Never stored or merged into actual API response caches.

---

## 5. Integration Checklist for Pavan's PR

When Pavan's `feat/phase5-dataset-evaluation` PR is ready:
1. Confirm endpoints `GET /benchmark/dataset-evaluations` and `GET /benchmark/dataset-evaluations/{id}` are live.
2. Verify CORS allows frontend origin (`http://127.0.0.1:5173`).
3. Connect `BenchmarkView.tsx` dataset evaluation tab to the live client methods.
4. Run regression test suite: `npm test -- --run`.
