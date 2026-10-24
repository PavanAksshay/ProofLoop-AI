export type Actor = 'agent' | 'gate' | 'tool' | 'verifier' | 'human' | 'system';

export type PolicyDecision = 'ALLOWED' | 'APPROVAL_REQUIRED' | 'BLOCKED';

export type Outcome =
  | 'VERIFIED'
  | 'UNVERIFIED'
  | 'BLOCKED'
  | 'ESCALATED'
  | 'PENDING_APPROVAL'
  | 'RUNNING';

export interface Event {
  sequence?: number;
  event_id: string;
  incident_id: string;
  timestamp: string;
  type: string;
  actor: Actor;
  payload: Record<string, any>;
  evidence_refs: string[];
}

export type HypothesisStatus = 'active' | 'confirmed' | 'refuted' | 'inconclusive';

export interface Hypothesis {
  id: string;
  title: string;
  description: string;
  category?: string;
  confidence_score?: number;
  supporting_evidence_ids: string[];
  contradicting_evidence_ids: string[];
  status: HypothesisStatus;
  required_evidence?: string[];
  applicable_diagnostics?: string[];
  last_ranking_change_reason?: string | null;
  uncertainty_notes?: string | null;
  suggested_diagnostic?: string | null;
  suggested_remediation?: ProposedActionPayload | null;
}

export type EvidenceKind =
  | 'direct_observation'
  | 'derived_measurement'
  | 'diagnostic_result'
  | 'inference'
  | 'contradictory';

export interface EvidenceItem {
  id: string;
  source: string;
  kind: EvidenceKind;
  summary: string;
  data: Record<string, any>;
  timestamp: string;
}

export interface DiagnosticProposal {
  tool: string;
  service: string;
  arguments: Record<string, any>;
  rationale: string;
  target_hypotheses: string[];
  expected_information_value?: number;
  distinguishing_power?: string;
}

export interface DiagnosticResult {
  tool: string;
  service: string;
  arguments: Record<string, any>;
  success: boolean;
  data: Record<string, any>;
  error?: string | null;
  timestamp: string;
}

export interface DiagnosisUpdate {
  diagnosis?: string | null;
  confidence?: number;
  confidence_basis: string;
  leading_hypothesis_id?: string | null;
  unresolved_uncertainties: string[];
}

export interface RemediationRecord {
  id: string;
  tool: string;
  service: string;
  arguments: Record<string, any>;
  attempt: number;
  success: boolean;
  originating_hypothesis_id?: string | null;
  supporting_evidence_ids: string[];
  policy_decision?: string | null;
  policy_rule_id?: string | null;
  approver_id?: string | null;
  execution_result: Record<string, any>;
  error?: string | null;
  resulting_observations?: Record<string, any>;
  verification_passed?: boolean | null;
  verification_checks: Array<Record<string, any>>;
  replanning_reason?: string | null;
  timestamp: string;
}

export interface InvestigationBudget {
  max_steps: number;
  max_diagnostics: number;
  max_remediations: number;
  steps_taken: number;
  diagnostics_run: number;
  remediations_attempted: number;
  remediations_proposed: number;
  remediations_blocked: number;
  remediations_pending_approval: number;
}

export interface InvestigationState {
  incident_id: string;
  symptoms: string[];
  step: number;
  hypotheses: Hypothesis[];
  evidence: EvidenceItem[];
  diagnostics_performed: DiagnosticResult[];
  outstanding_uncertainties: string[];
  current_diagnosis?: DiagnosisUpdate | null;
  proposed_next_step?: DiagnosticProposal | ProposedActionPayload | null;
  remediation_history: RemediationRecord[];
  budget: InvestigationBudget;
  termination_reason?: string | null;
  replanning_cycle: number;
  last_evaluation_summary?: string | null;
  escalation_reason?: string | null;
}

export interface IncidentResponse {
  incident_id: string;
  scenario: string;
  client: string;
  outcome: Outcome;
  summary: string;
  mode: string;
  events: Event[];
  investigation_state?: InvestigationState | null;
}

export interface IncidentSummaryItem {
  incident_id: string;
  scenario: string;
  client: string;
  outcome: Outcome;
  summary: string;
  mode: string;
  created_at: string;
  updated_at: string;
}

export interface ScenariosResponse {
  scenarios: string[];
  clients: string[];
  modes: string[];
}

export interface HealthResponse {
  status: string;
  configured_mode: string;
  implementation: string;
}

export interface CustomScenarioParams {
  custom_logs?: string[];
  initial_error_rate?: number;
  config_version?: string;
  checkout_failures?: number;
  health_endpoint_status?: number;
  description?: string;
}

export interface IncidentStartResponse {
  incident_id: string;
  outcome: Outcome;
  events_url: string;
  incident_url: string;
}

export interface ApprovalDecisionRequest {
  decision: 'approve' | 'deny';
  approver_id: string;
  comment?: string;
}

export interface VerificationCheck {
  check_name: string;
  passed: boolean;
  observed: Record<string, any>;
}

export interface VerificationReport {
  all_passed: boolean;
  checks: VerificationCheck[];
}

export interface ProposedActionPayload {
  tool: string;
  service: string;
  arguments: Record<string, any>;
  rule_id?: string;
  reason?: string;
  attempt?: number;
  investigation_step?: number;
  mode?: string;
  rationale?: string;
}

export interface BenchmarkParams {
  scenarios: string[];
  client: string;
  trials: number;
  seed: number;
}

export interface MetricRecord {
  value: number;
  numerator: number;
  denominator: number;
  metric_name: string;
  formula: string;
  description: string;
}

export interface SystemMetrics {
  system: string;
  total_runs: number;
  verified_recovery_rate: MetricRecord;
  false_success_rate: MetricRecord;
  unauthorized_mutations: MetricRecord;
  avg_tool_calls: MetricRecord;
  avg_time_ms: MetricRecord;
  escalation_correctness: MetricRecord;
  recovery_after_failed_first_action?: MetricRecord;
  repeated_ineffective_action_rate?: MetricRecord;
  avg_diagnostics_per_run?: MetricRecord;
  avg_remediations_per_run?: MetricRecord;
  time_to_verified_recovery?: MetricRecord;
}

export interface ScenarioResultBreakdown {
  baseline: SystemMetrics;
  proofloop: SystemMetrics;
  trials_count: number;
}

export interface TrialDetail {
  scenario: string;
  client: string;
  trial_index: number;
  seed?: number;
  outcome: string;
  summary: string;
  elapsed_ms: number;
  tool_calls: Array<Record<string, any>>;
  unauthorized_mutations: number;
  policy_violations: Array<Record<string, any>>;
  ground_truth_healthy: boolean;
  verification_checks?: Array<Record<string, any>>;
}

export interface BenchmarkResult {
  run_id: string;
  timestamp: string;
  software_revision: string;
  parameters: {
    scenarios: string[];
    supported_scenarios_evaluated: string[];
    client: string;
    trials_per_scenario: number;
    seed: number;
  };
  metrics: {
    baseline: SystemMetrics;
    proofloop: SystemMetrics;
  };
  per_scenario: Record<string, ScenarioResultBreakdown>;
  raw_trials: {
    baseline: TrialDetail[];
    proofloop: TrialDetail[];
  };
  skipped_scenarios: Array<{ scenario: string; reason: string }>;
  disclaimer: string;
}

export interface BenchmarkRunResponse {
  run_id: string;
  status: 'running' | 'completed' | 'failed';
  benchmark_url: string;
  result?: BenchmarkResult;
  error_message?: string;
}

export interface ActionDetail {
  actionId?: string;
  tool: string;
  service?: string;
  arguments?: Record<string, any>;
  incidentId?: string;
  attempt?: number;
  investigationStep?: number;
  rationale?: string;
  supportingEvidenceRefs?: string[];
  policyDecision?: PolicyDecision | 'REVALIDATION_FAILED' | null;
  policyRuleId?: string | null;
  policyReason?: string | null;
  approvalRequired?: boolean;
  approvalState?: 'pending' | 'approved' | 'denied' | 'none' | null;
  approverId?: string | null;
  approvalComment?: string | null;
  executionStatus?: 'not_started' | 'running' | 'success' | 'failed' | null;
  executionResult?: Record<string, any> | null;
  executionError?: string | null;
  verificationOutcome?: 'pending' | 'passed' | 'failed' | 'inconclusive' | null;
  verificationChecks?: VerificationCheck[];
  timestamp?: string;
  actor?: Actor;
  expectedImpact?: string | null;
  reversibility?: string | null;
}

export type LifecycleStageKey =
  | 'proposal'
  | 'policy'
  | 'approval'
  | 'execution'
  | 'verification'
  | 'outcome';

export interface LifecycleStage {
  key: LifecycleStageKey;
  label: string;
  status: 'passed' | 'failed' | 'blocked' | 'rejected' | 'pending' | 'skipped' | 'active' | 'inconclusive';
  timestamp?: string;
  actor?: Actor;
  summary: string;
  details?: Record<string, any>;
  evidenceRefs?: string[];
}

export interface PolicyDecisionRecord {
  ruleId: string;
  decision: PolicyDecision | 'REVALIDATION_FAILED';
  reason: string;
  actionTool: string;
  actionService?: string;
  arguments?: Record<string, any>;
  incidentId?: string;
  timestamp?: string;
  evidenceRefs?: string[];
  executionSuccess?: boolean | null;
  verificationPassed?: boolean | null;
}


export type ProvenanceKind = 'observed' | 'inferred' | 'unknown';

export interface IncidentAnalyticsSummary {
  totalIncidents: number;
  verifiedRecoveries: number;
  unverifiedOrFailed: number;
  escalatedCount: number;
  pendingApprovals: number;
  runningCount: number;
  verifiedRecoveryRate: number; // 0.0 - 1.0
  falseSuccessRate: number | null; // null when ground truth / check records unavailable
  falseSuccessExplanation: string;
  falseSuccessNumerator?: number;
  falseSuccessDenominator?: number;
  policyViolationRate: number | null; // null when policy decision history is unavailable
  policyViolationExplanation: string;
  blockedActionCount?: number;
  attemptedViolationCount?: number;
  meanTimeToRecoveryMs: number | null; // null if timestamps unavailable or invalid
  recoveryDurationExplanation: string;
  scenarioBreakdown: Record<string, { total: number; verified: number; escalated: number; failed: number }>;
  clientBreakdown: Record<string, number>;
  outcomeBreakdown: Record<Outcome, number>;
  recentTimeline: Array<{ incident_id: string; scenario: string; outcome: Outcome; timestamp: string }>;
}

export interface ServiceTopologyNode {
  id: string;
  name: string;
  type: 'service' | 'database' | 'gateway' | 'config' | 'cache' | 'external';
  status: 'healthy' | 'degraded' | 'failed' | 'unknown';
  provenance: ProvenanceKind;
  statusRationale: string;
  observedLatencyMs?: number;
  observedErrorRate?: number;
  isSuspectedRootCause?: boolean;
  isRemediationTarget?: boolean;
  evidenceRefs: string[];
  diagnosticsRun: string[];
}

export interface ServiceTopologyLink {
  source: string;
  target: string;
  provenance: 'inferred' | 'observed';
  protocol?: string | null;
  healthy: boolean;
  observedErrors?: number;
  rationale: string;
  evidenceRefs: string[];
}

export interface ServiceTopologyGraph {
  nodes: ServiceTopologyNode[];
  links: ServiceTopologyLink[];
  inferredAt?: string;
  sourceIncidentId: string;
  hasSufficientTelemetry: boolean;
  unavailableReason?: string;
}

export interface DatasetEvaluationSummaryItem {
  evaluation_id: string;
  dataset_name: string;
  dataset_version: string;
  dataset_provenance: string;
  total_cases: number;
  timestamp: string;
  evaluator_version: string;
  status: 'completed' | 'running' | 'failed';
  top1_accuracy?: number;
  top3_accuracy?: number;
}

export interface DatasetEvaluationDetail {
  evaluation_id: string;
  dataset_metadata: {
    name: string;
    version: string;
    license: string;
    split: string;
    case_count: number;
  };
  aggregate_metrics: {
    top1_diagnosis_accuracy: { value: number; numerator: number; denominator: number; description: string };
    top3_diagnosis_accuracy: { value: number; numerator: number; denominator: number; description: string };
    mean_diagnostic_steps: { value: number; description: string };
    diagnostic_efficiency_ratio: { value: number; description: string };
    hallucination_or_unsupported_rate: { value: number; description: string };
  };
  category_breakdown: Record<string, { cases: number; accuracy: number }>;
  cases: Array<{
    case_id: string;
    title: string;
    ground_truth_category: string;
    predicted_category: string;
    predicted_hypothesis_title: string;
    confidence: number;
    diagnostics_called: string[];
    match: boolean;
    explanation?: string;
  }>;
}
