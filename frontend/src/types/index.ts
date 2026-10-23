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

export interface IncidentResponse {
  incident_id: string;
  scenario: string;
  client: string;
  outcome: Outcome;
  summary: string;
  mode: string;
  events: Event[];
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

