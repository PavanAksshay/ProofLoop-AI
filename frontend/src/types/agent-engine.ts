export type AgentNodeId =
  | 'orchestrator'
  | 'investigation'
  | 'hypothesis'
  | 'policy'
  | 'remediation'
  | 'verification';

export type AgentNodeStatus =
  | 'idle'
  | 'active'
  | 'waiting'
  | 'blocked'
  | 'completed'
  | 'failed';

export interface AgentNodeMetadata {
  id: AgentNodeId;
  label: string;
  role: string;
  workflowStage: string;
  description: string;
  position3D: [number, number, number]; // [x, y, z] in Three.js space
  colorKey: string;
}

export interface AgentNodeRuntimeState {
  id: AgentNodeId;
  label: string;
  stage: string;
  roleDescription: string;
  status: AgentNodeStatus;
  statusLabel: string;
  activeCount: number;
  latestEventName?: string;
  latestEventSummary?: string;
  latestTimestamp?: string;
  lastEventSummary?: string;
  lastSequence?: number;
  evidenceRefs: string[];
  metrics?: Record<string, string | number>;
  failureReason?: string;
}

export interface ConduitConnection {
  from: AgentNodeId;
  to: AgentNodeId;
  isActive: boolean;
  status: AgentNodeStatus;
  label?: string;
}

export interface OperationalTelemetry {
  evidenceCount: number;
  hypothesisCount: number;
  leadingConfidence: number | null;
  leadingHypothesis?: string | null;
  diagnosticsRun: number;
  diagnosticsMax: number;
  remediationsRun: number;
  remediationsMax: number;
  verificationPassed: boolean | null;
  verificationChecks: Array<{ name: string; passed: boolean }>;
  verificationTotal: number;
  verificationPassedCount: number;
  verificationFailedCount: number;
  verificationReportAvailable: boolean;
  replanningCycles: number;
  replanningCount?: number;
  elapsedMs: number;
  incidentOutcome: string;
  policyRequiresApproval?: boolean;
  policyDecision?: string | null;
  remediationAction?: string | null;
  remediationBudgetRemaining?: number;
  diagnosticBudgetRemaining?: number;
}

export interface NormalizedEngineState {
  incidentId: string | null;
  scenario: string | null;
  client: string | null;
  outcome: string;
  currentWorkflowStage: string;
  activeNodeId: AgentNodeId;
  selectedNodeId: AgentNodeId;
  nodes: Record<AgentNodeId, AgentNodeRuntimeState>;
  conduits: ConduitConnection[];
  telemetry: OperationalTelemetry;
  recentEvents: Array<{
    sequence?: number;
    eventId: string;
    type: string;
    actor: string;
    timestamp: string;
    summary: string;
  }>;
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'completed' | 'idle';
  isPendingApproval: boolean;
  isEscalated: boolean;
  isVerified: boolean;
  isBlocked: boolean;
  updatedAt: string;
}
