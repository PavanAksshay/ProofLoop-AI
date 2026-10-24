# ProofLoop AI — Real-World Dataset Diagnosis Evaluation Protocol

## 1. Executive Summary

This protocol defines the formal methodology for benchmarking ProofLoop AI's root-cause analysis (RCA) and diagnosis engine against real-world operational datasets, specifically **Cloud-OpsBench**.

Unlike synthetic remediation benchmarks that test active recovery actions in a closed simulator, dataset diagnosis evaluation tests whether ProofLoop can diagnose complex operational failures from realistic distributed evidence—logs, metrics, alerts, and Kubernetes resource snapshots—**without prior knowledge of the failure mode** and **without mutating any infrastructure**.

---

## 2. Hard Governance Invariants

1. **Strict Read-Only Execution**:
   Under no circumstances will diagnosis evaluation invoke mutating or remediation tools (`rollback_config`, `modify_database`, `scale_service`, `restart_pod`, etc.). Diagnosis evaluation measures investigation precision and evidence interpretation, not remediation execution.

2. **Absolute Ground-Truth Isolation (Zero Leakage)**:
   The evaluation harness enforces architectural separation between agent-visible observations and evaluator ground truth. Evaluator-only fields (`root_cause`, `fault_object`, `fault_taxonomy`, `milestones`, `golden_trajectories`) are stripped before any agent or baseline logic is invoked.

3. **Honest Accounting and Non-Fabrication**:
   Target metrics must be calculated from real predictions. If a metric cannot be computed (e.g. missing ground truth or unparseable telemetry), it must be reported as `undefined` or `not_applicable`, not filled with synthetic zeroes or inflated accuracy.

4. **100% Offline CI Determinism**:
   Unit and CI test suites must run deterministically using offline fixtures without making outbound network requests or requiring external API tokens.

---

## 3. Evaluation Pipeline Architecture

```text
+-------------------------------------------------------------------------------+
|                        Cloud-OpsBench / Raw Dataset                           |
|  (index.jsonl, metadata.json, tool_cache.json, process-label, trajectories)  |
+-------------------------------------------------------------------------------+
                                      |
                                      v
                      [ Dataset Adapter & Normalizer ]
                       (Validates schema, filters)
                                      |
             +------------------------+------------------------+
             |                                                 |
             v                                                 v
+-----------------------------+               +-------------------------------+
|     AgentIncidentInput      |               |     EvaluatorGroundTruth      |
|  - case_id, system          |               |  - root_cause                 |
|  - namespace, query         |               |  - fault_object               |
|  - symptoms, observations   |               |  - fault_taxonomy             |
|  - read-only tool cache     |               |  - valid_alternatives         |
|  (STRICTLY NO GROUND TRUTH) |               |  (HELD IN EVALUATOR VAULT)    |
+-----------------------------+               +-------------------------------+
             |                                                 |
             v                                                 |
+-----------------------------+                                |
|   ProofLoop Diagnosis Engine|                                |
|   - Hypothesis formulation  |                                |
|   - EIV diagnostic selection|                                |
|   - Evidence ledger updates |                                |
|   - Ranked hypotheses       |                                |
+-----------------------------+                                |
             |                                                 |
             v                                                 |
+-----------------------------+                                |
|    Diagnosed Root Cause     |                                |
|    (Top-1, Top-2, Top-3)    |                                |
+-----------------------------+                                |
             |                                                 |
             +------------------------+------------------------+
                                      |
                                      v
                      [ Independent Evaluator Engine ]
                      - Top-1 Accuracy Computation
                      - Top-3 Accuracy Computation
                      - Evidence Traceability Audit
                      - Baseline Comparison
                                      |
                                      v
               +---------------------------------------------+
               | Final Report (JSON, CSV, Terminal Summary)  |
               +---------------------------------------------+
```

---

## 4. Evaluation Metrics & Definitions

### 4.1 Top-1 Root-Cause Accuracy
Percentage of eligible evaluated cases where the agent's leading (highest confidence) hypothesis correctly identifies the ground-truth root cause or faulty component.
$$\text{Top-1 Accuracy} = \frac{\sum_{i=1}^{N_{\text{evaluated}}} \mathbb{I}(\text{Top1Match}_i)}{N_{\text{evaluated}}} \times 100\%$$
- **Numerator**: Count of evaluated cases where rank-1 hypothesis matches ground truth.
- **Denominator**: Total number of evaluated eligible cases ($N_{\text{evaluated}}$).

### 4.2 Top-3 Root-Cause Accuracy
Percentage of eligible evaluated cases where the ground-truth root cause or faulty component is present within the agent's top 3 ranked hypotheses.
$$\text{Top-3 Accuracy} = \frac{\sum_{i=1}^{N_{\text{evaluated}}} \mathbb{I}(\text{Top3Match}_i)}{N_{\text{evaluated}}} \times 100\%$$
- **Numerator**: Count of evaluated cases where ground truth appears in top 3 hypotheses.
- **Denominator**: Total number of evaluated eligible cases ($N_{\text{evaluated}}$).

### 4.3 Case Accounting Metrics
- **Total Ingested Cases ($N_{\text{total}}$)**: All records in the manifest or input file.
- **Eligible Cases ($N_{\text{eligible}}$)**: Cases that meet criteria for read-only diagnosis evaluation.
- **Excluded Cases ($N_{\text{excluded}}$)**: Cases skipped with explicit reason codes:
  - `MALFORMED_RECORD`: Schema validation error or missing required fields.
  - `MISSING_TELEMETRY`: Case has no logs, metrics, or tool responses.
  - `INTERACTIVE_DEPENDENCY`: Case requires live infrastructure mutations that cannot be evaluated from static snapshots.
- **Evaluation Failure Count ($N_{\text{failed}}$)**: Cases where evaluation raised an unhandled exception or timed out.

### 4.4 Traceability & Efficiency Metrics
Where supported by dataset telemetry:
- **Average Diagnostic Inquiries**: Mean number of read-only tool cache lookups executed per case.
- **Average Elapsed Latency (ms)**: Mean wall-clock time required to formulate final diagnosis.
- **Evidence-to-Diagnosis Traceability**: Percentage of diagnoses supported by at least one explicit evidence item in the ledger.

---

## 5. Ground-Truth Matching Rules

To avoid arbitrary or inflated scoring, root-cause matching adheres to strict rules:

1. **Exact Match**: The normalized hypothesis category, title, or target component matches the ground-truth root cause identifier (e.g. `missing_service_account` == `missing_service_account`, `adservice` == `app/adservice`).
2. **Category / Taxonomy Match**: If the dataset specifies a hierarchical category or taxonomy (e.g. `Admission_Fault`, `database_connection_pool`), matching the category counts as a **Category Match**, which is reported separately from an **Exact Root-Cause Match**.
3. **Alternative Labels**: If the ground truth specifies alternative valid labels (e.g. `pod_oom_killed` and `memory_limit_exceeded`), any alternative label in the verified set is accepted.
4. **No Partial Credit Without Policy**: A partial string match (e.g. "service" in "service_unreachable") is **never** counted as a correct root-cause match.

---

## 6. Baseline Protocol

To ensure fair comparison, a scripted heuristic baseline is evaluated alongside ProofLoop:
- **Baseline Principle**: Evaluates keyword frequency and simple heuristic rules against the identical `AgentIncidentInput`.
- **Fair Isolation**: Baseline receives zero evaluator ground truth, runs against the exact same eligible case set, and produces top-1 and top-3 predictions.

---

## 7. Report Schema & Reproducibility Requirements

Every evaluation run generates a machine-readable JSON and CSV report in `benchmark/results/` (git-ignored) recording:
- `run_id`: Unique run identifier.
- `timestamp`: UTC ISO 8601 timestamp.
- `software_revision`: Git commit hash of ProofLoop AI.
- `dataset`:
  - `name`: `Cloud-OpsBench`
  - `distribution_version`: `v1.0.0`
  - `source_commit`: `ea05dafbc87b5985df8721622d63d4229c2b4224`
- `parameters`: Evaluation settings, case filters, random seed.
- `metrics`: Top-1 accuracy, Top-3 accuracy, numerators, denominators, and case counts.
- `per_case_results`: Array of case IDs, predictions, match flags, and evidence references.
- `exclusions`: Detailed log of any skipped cases with specific reasons.
