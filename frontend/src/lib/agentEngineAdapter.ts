import {
  AgentNodeId,
  AgentNodeMetadata,
  AgentNodeRuntimeState,
  AgentNodeStatus,
  ConduitConnection,
  NormalizedEngineState,
  OperationalTelemetry,
} from '../types/agent-engine';
import { Event, IncidentResponse, InvestigationState } from '../types';

export const AGENT_PALETTE = {
  bgDeep: '#F5EFEB',
  bgSurface: '#FAF6F0',
  bgSurfaceElevated: '#FFFFFF',
  borderGunmetal: '#DFD7C7',
  borderSubtle: '#ECE6DC',
  textPrimary: '#1C1917',
  textSecondary: '#6B6255',
  orbBlack: '#18181B',
  orbBlackSpecular: '#27272A',
  stateActive: '#0D9488',
  stateWaiting: '#D97706',
  stateFailed: '#DC2626',
  stateCompleted: '#16A34A',
  stateIdle: '#78716C',
  gridLines: '#DFD7C7',
};

export const AGENT_METADATA: Record<AgentNodeId, AgentNodeMetadata> = {
  orchestrator: {
    id: 'orchestrator',
    label: 'ORCHESTRATOR',
    role: 'Central Incident Lifecycle & Adaptive Replanning',
    workflowStage: 'LIFECYCLE COORDINATION',
    description: 'Directs workflow transitions, manages global action/investigation budgets, and governs adaptive recovery replanning.',
    position3D: [0, 0.4, 0],
    colorKey: 'stateActive',
  },
  investigation: {
    id: 'investigation',
    label: 'INVESTIGATION',
    role: 'Telemetry Ingestion & EIV Diagnostic Probing',
    workflowStage: 'OBSERVATION & DIAGNOSTICS',
    description: 'Ingests logs, metrics, and Kubernetes objects into the Evidence Ledger. Executes distinguishing read-only diagnostics based on Expected Information Value.',
    position3D: [-3.6, 1.4, 0],
    colorKey: 'stateActive',
  },
  hypothesis: {
    id: 'hypothesis',
    label: 'HYPOTHESIS ENGINE',
    role: 'Competing Root-Cause Theory Formulation',
    workflowStage: 'HYPOTHESIS EVALUATION',
    description: 'Maintains competing causal explanations, scoring confidence against corroborating and contradicting evidence items.',
    position3D: [-1.9, 3.2, 0],
    colorKey: 'stateActive',
  },
  policy: {
    id: 'policy',
    label: 'POLICY GATE',
    role: 'Deterministic Rule Enforcement & Approvals',
    workflowStage: 'GOVERNANCE & APPROVAL',
    description: 'Deterministic gate separating AI proposals from execution. Halts high-risk or disallowed actions in PENDING_APPROVAL.',
    position3D: [1.9, 3.2, 0],
    colorKey: 'stateWaiting',
  },
  remediation: {
    id: 'remediation',
    label: 'REMEDIATION',
    role: 'Authorized Action Dispatcher',
    workflowStage: 'ACTION EXECUTION',
    description: 'Dispatches authorized simulated mutations (rollback, database repair, pod restart) with bounded retry budgets.',
    position3D: [3.6, 1.4, 0],
    colorKey: 'stateActive',
  },
  verification: {
    id: 'verification',
    label: 'INDEPENDENT VERIFIER',
    role: 'Invariant Multi-Check Prover (Zero False-Green)',
    workflowStage: 'INDEPENDENT VERIFICATION',
    description: 'Executes independent synthetic transaction probes and invariant assertions. Never relies on shallow HTTP 200 health signals.',
    position3D: [0, -2.85, 0],
    colorKey: 'stateCompleted',
  },
};

export const DEFAULT_CONDUITS: Array<{ from: AgentNodeId; to: AgentNodeId; label: string }> = [
  { from: 'orchestrator', to: 'investigation', label: 'ingest_telemetry' },
  { from: 'investigation', to: 'hypothesis', label: 'correlate_evidence' },
  { from: 'hypothesis', to: 'policy', label: 'propose_action' },
  { from: 'policy', to: 'remediation', label: 'authorize_mutation' },
  { from: 'remediation', to: 'verification', label: 'verify_invariants' },
  { from: 'verification', to: 'orchestrator', label: 'report_outcome' },
];

export function getStatusColor(status: AgentNodeStatus): string {
  switch (status) {
    case 'active':
      return AGENT_PALETTE.stateActive;
    case 'waiting':
      return AGENT_PALETTE.stateWaiting;
    case 'failed':
    case 'blocked':
      return AGENT_PALETTE.stateFailed;
    case 'completed':
      return AGENT_PALETTE.stateCompleted;
    case 'idle':
    default:
      return AGENT_PALETTE.stateIdle;
  }
}

export function createInitialNodeStates(): Record<AgentNodeId, AgentNodeRuntimeState> {
  const initial: Partial<Record<AgentNodeId, AgentNodeRuntimeState>> = {};
  (Object.keys(AGENT_METADATA) as AgentNodeId[]).forEach((id) => {
    const meta = AGENT_METADATA[id];
    initial[id] = {
      id,
      label: meta.label,
      stage: meta.workflowStage,
      roleDescription: meta.description,
      status: 'idle',
      statusLabel: 'STANDBY',
      activeCount: 0,
      evidenceRefs: [],
      lastEventSummary: undefined,
      lastSequence: undefined,
    };
  });
  return initial as Record<AgentNodeId, AgentNodeRuntimeState>;
}

export function normalizeEngineState(
  incident: IncidentResponse | null,
  investigation: InvestigationState | null,
  events: Event[] = [],
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'completed' | 'idle' = 'idle'
): NormalizedEngineState {
  const nodes = createInitialNodeStates();
  const outcome = incident?.outcome || 'IDLE';
  const scenario = incident?.scenario || null;
  const client = incident?.client || null;
  const incidentId = incident?.incident_id || null;

  let activeNodeId: AgentNodeId = 'orchestrator';
  let currentWorkflowStage = 'IDLE - NO ACTIVE INCIDENT';

  // Gather chronological events
  const sortedEvents = [...events].sort((a, b) => {
    if (typeof a.sequence === 'number' && typeof b.sequence === 'number') {
      return a.sequence - b.sequence;
    }
    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  });

  // Telemetry aggregates
  let evidenceCount = investigation?.evidence?.length ?? 0;
  let hypothesisCount = investigation?.hypotheses?.length ?? 0;
  let leadingConfidence: number | null = null;
  if (investigation?.hypotheses && investigation.hypotheses.length > 0) {
    leadingConfidence = investigation.hypotheses[0].confidence_score ?? 0.5;
  }

  let diagnosticsRun = investigation?.budget?.diagnostics_run ?? investigation?.diagnostics_performed?.length ?? 0;
  let diagnosticsMax = investigation?.budget?.max_diagnostics ?? 5;
  let remediationsRun = investigation?.budget?.remediations_attempted ?? investigation?.remediation_history?.length ?? 0;
  let remediationsMax = investigation?.budget?.max_remediations ?? 3;
  let replanningCycles = investigation?.replanning_cycle ?? 0;

  let policyDecision: string | null = null;
  let remediationAction: string | null = null;
  let leadingHypothesis: string | null =
    investigation?.hypotheses && investigation.hypotheses.length > 0
      ? investigation.hypotheses[0].title
      : null;

  const verificationChecks: Array<{ name: string; passed: boolean }> = [];
  let verificationPassed: boolean | null = null;

  // Process event stream to determine precise node states
  for (const ev of sortedEvents) {
    const payload = ev.payload || {};
    const evType = ev.type;

    if (ev.evidence_refs?.length) {
      nodes.investigation.evidenceRefs = Array.from(
        new Set([...nodes.investigation.evidenceRefs, ...ev.evidence_refs])
      );
    }

    switch (evType) {
      case 'incident_opened':
        nodes.orchestrator.status = 'active';
        nodes.orchestrator.statusLabel = 'INITIALIZING';
        nodes.orchestrator.latestEventName = 'incident_opened';
        nodes.orchestrator.latestEventSummary = `Incident started: ${payload.scenario || 'generic'}`;
        activeNodeId = 'orchestrator';
        currentWorkflowStage = 'INCIDENT OPENED';
        break;

      case 'investigation_started':
      case 'evidence_observed':
      case 'evidence_collected':
        nodes.investigation.status = 'active';
        nodes.investigation.statusLabel = 'OBSERVING';
        nodes.investigation.latestEventName = evType;
        nodes.investigation.latestEventSummary = payload.summary || `Observed: ${payload.source || 'telemetry'}`;
        if (ev.evidence_refs?.length) {
          nodes.investigation.evidenceRefs = Array.from(new Set([...nodes.investigation.evidenceRefs, ...ev.evidence_refs]));
        }
        activeNodeId = 'investigation';
        currentWorkflowStage = 'EVIDENCE COLLECTION';
        break;

      case 'diagnostic_selected':
      case 'diagnostic_started':
      case 'diagnostic_completed':
        nodes.investigation.status = 'active';
        nodes.investigation.statusLabel = evType === 'diagnostic_completed' ? 'DIAGNOSTIC COMPLETED' : 'PROBING';
        nodes.investigation.latestEventName = evType;
        nodes.investigation.latestEventSummary = `Tool: ${payload.tool || 'probe'} (EIV: ${payload.expected_information_value ?? '0.5'})`;
        diagnosticsRun += 1;
        activeNodeId = 'investigation';
        currentWorkflowStage = 'DIAGNOSTIC PROBING';
        break;

      case 'hypothesis_created':
      case 'hypothesis_updated':
      case 'evidence_correlated':
      case 'diagnosis_updated':
        nodes.hypothesis.status = 'active';
        nodes.hypothesis.statusLabel = 'SCORING';
        nodes.hypothesis.latestEventName = evType;
        nodes.hypothesis.latestEventSummary = payload.title || payload.diagnosis || 'Updating causal hypothesis weights';
        if (payload.title || payload.diagnosis) {
          leadingHypothesis = payload.title || payload.diagnosis;
        }
        if (typeof payload.confidence_score === 'number') {
          leadingConfidence = payload.confidence_score;
        }
        activeNodeId = 'hypothesis';
        currentWorkflowStage = 'HYPOTHESIS EVALUATION';
        break;

      case 'action_proposed':
      case 'remediation_proposed':
        nodes.hypothesis.status = 'completed';
        nodes.hypothesis.statusLabel = 'HYPOTHESIS FORMULATED';
        nodes.policy.status = 'active';
        nodes.policy.statusLabel = 'EVALUATING POLICY';
        nodes.policy.latestEventName = evType;
        remediationAction = payload.tool || payload.action || payload.remediation || 'Safe mutation';
        nodes.policy.latestEventSummary = `Proposed: ${remediationAction}`;
        activeNodeId = 'policy';
        currentWorkflowStage = 'POLICY EVALUATION';
        break;

      case 'policy_decision':
        const decision = payload.decision;
        policyDecision = decision;
        if (decision === 'ALLOWED') {
          nodes.policy.status = 'completed';
          nodes.policy.statusLabel = 'PRE-AUTHORIZED';
          nodes.policy.latestEventSummary = `Policy Rule ${payload.rule_id || 'OK'} Allowed`;
        } else if (decision === 'APPROVAL_REQUIRED') {
          nodes.policy.status = 'waiting';
          nodes.policy.statusLabel = 'PENDING APPROVAL';
          nodes.policy.latestEventSummary = payload.reason || 'Human authorization mandatory';
          activeNodeId = 'policy';
          currentWorkflowStage = 'AWAITING OPERATOR APPROVAL';
        } else if (decision === 'BLOCKED') {
          nodes.policy.status = 'blocked';
          nodes.policy.statusLabel = 'MUTATION BLOCKED';
          nodes.policy.latestEventSummary = payload.reason || 'Action denied by governance policy';
          activeNodeId = 'policy';
          currentWorkflowStage = 'ACTION BLOCKED BY POLICY';
        }
        break;

      case 'approval_requested':
        policyDecision = 'APPROVAL_REQUIRED';
        nodes.policy.status = 'waiting';
        nodes.policy.statusLabel = 'APPROVAL REQUIRED';
        nodes.policy.latestEventName = 'approval_requested';
        nodes.policy.latestEventSummary = `Rule ${payload.rule_id}: ${payload.reason || 'Waiting for human on-call signoff'}`;
        nodes.remediation.status = 'waiting';
        nodes.remediation.statusLabel = 'HELD AT GATE';
        activeNodeId = 'policy';
        currentWorkflowStage = 'APPROVAL REQUIRED (GATE PAUSED)';
        break;

      case 'human_approval_decision':
        nodes.policy.status = payload.decision === 'approve' ? 'completed' : 'blocked';
        nodes.policy.statusLabel = payload.decision === 'approve' ? 'APPROVED' : 'DENIED BY OPERATOR';
        nodes.policy.latestEventSummary = `Decision by ${payload.approver_id || 'operator'}: ${payload.decision}`;
        break;

      case 'tool_executed':
        nodes.remediation.status = payload.success ? 'active' : 'failed';
        nodes.remediation.statusLabel = payload.success ? 'EXECUTED' : 'EXECUTION FAILED';
        nodes.remediation.latestEventName = 'tool_executed';
        nodes.remediation.latestEventSummary = `${payload.tool}: ${payload.message || (payload.success ? 'Success' : 'Error')}`;
        activeNodeId = 'remediation';
        currentWorkflowStage = 'ACTION DISPATCHED';
        break;

      case 'remediation_evaluation_started':
      case 'verification_check':
        nodes.remediation.status = 'completed';
        nodes.remediation.statusLabel = 'APPLIED';
        nodes.verification.status = 'active';
        nodes.verification.statusLabel = 'VERIFYING INVARIANTS';
        nodes.verification.latestEventName = evType;
        if (evType === 'verification_check') {
          verificationChecks.push({
            name: payload.check_name || 'invariant_probe',
            passed: !!payload.passed,
          });
          nodes.verification.latestEventSummary = `Check ${payload.check_name}: ${payload.passed ? 'PASSED' : 'FAILED'}`;
        }
        activeNodeId = 'verification';
        currentWorkflowStage = 'INDEPENDENT VERIFICATION';
        break;

      case 'verification_result':
        verificationPassed = !!payload.all_passed;
        nodes.verification.status = verificationPassed ? 'completed' : 'failed';
        nodes.verification.statusLabel = verificationPassed ? 'VERIFIED HEALTHY' : 'INVARIANTS FAILED';
        nodes.verification.latestEventSummary = verificationPassed ? 'All independent checks confirmed recovery' : 'Independent verification failed';
        break;

      case 'independent_verification_failed':
      case 'recovery_invariant_failed':
        verificationPassed = false;
        nodes.verification.status = 'failed';
        nodes.verification.statusLabel = 'VERIFICATION FAILED';
        nodes.verification.latestEventSummary = 'Recovery rejected: invariant assertion failed';
        break;

      case 'replanning_started':
      case 'recovery_plan_changed':
        nodes.orchestrator.status = 'active';
        nodes.orchestrator.statusLabel = 'REPLANNING CYCLE';
        nodes.orchestrator.latestEventName = evType;
        nodes.orchestrator.latestEventSummary = payload.rationale || 'Previous remediation ineffective; adapting causal strategy';
        activeNodeId = 'orchestrator';
        currentWorkflowStage = 'ADAPTIVE REPLANNING';
        break;

      case 'investigation_limit_reached':
      case 'investigation_budget_exhausted':
      case 'retry_budget_exhausted':
      case 'investigation_escalated':
        nodes.orchestrator.status = 'failed';
        nodes.orchestrator.statusLabel = 'ESCALATED';
        nodes.orchestrator.latestEventSummary = payload.reason || payload.message || 'Budget exhausted; incident escalated';
        activeNodeId = 'orchestrator';
        currentWorkflowStage = 'SAFE ESCALATION';
        break;

      case 'outcome':
        const finalOutcome = payload.outcome;
        if (finalOutcome === 'VERIFIED') {
          nodes.verification.status = 'completed';
          nodes.orchestrator.status = 'completed';
          nodes.orchestrator.statusLabel = 'RESOLVED & PROVEN';
          currentWorkflowStage = 'TERMINAL: VERIFIED RECOVERY';
          activeNodeId = 'verification';
        } else if (finalOutcome === 'ESCALATED') {
          nodes.orchestrator.status = 'failed';
          nodes.orchestrator.statusLabel = 'ESCALATED SAFELY';
          currentWorkflowStage = 'TERMINAL: ESCALATED';
          activeNodeId = 'orchestrator';
        } else if (finalOutcome === 'BLOCKED') {
          nodes.policy.status = 'blocked';
          nodes.orchestrator.status = 'blocked';
          nodes.orchestrator.statusLabel = 'BLOCKED BY POLICY';
          currentWorkflowStage = 'TERMINAL: BLOCKED';
          activeNodeId = 'policy';
        }
        break;
    }
  }

  // Authoritative reconciliations from incident model snapshot
  const hasOutcomeEvent = sortedEvents.some((e) => e.type === 'outcome');
  const outcomeEvent = sortedEvents.find((e) => e.type === 'outcome');
  const effectiveOutcome = hasOutcomeEvent
    ? (outcomeEvent?.payload?.outcome || outcome)
    : (outcome === 'RUNNING' ? 'RUNNING' : outcome);

  const isPendingApproval = effectiveOutcome === 'PENDING_APPROVAL' || nodes.policy.status === 'waiting';
  const isEscalated = effectiveOutcome === 'ESCALATED' || nodes.orchestrator.status === 'failed';
  const isVerified = effectiveOutcome === 'VERIFIED';
  const isBlocked = effectiveOutcome === 'BLOCKED';

  if (isPendingApproval) {
    nodes.policy.status = 'waiting';
    nodes.policy.statusLabel = 'APPROVAL REQUIRED';
    nodes.remediation.status = 'waiting';
    nodes.remediation.statusLabel = 'BLOCKED AT GATE';
    activeNodeId = 'policy';
    currentWorkflowStage = 'PENDING OPERATOR APPROVAL';
  } else if (isVerified) {
    nodes.verification.status = 'completed';
    nodes.verification.statusLabel = 'INVARIANTS CONFIRMED';
    nodes.remediation.status = 'completed';
    nodes.orchestrator.status = 'completed';
    nodes.orchestrator.statusLabel = 'RESOLVED';
    activeNodeId = 'verification';
    currentWorkflowStage = 'VERIFIED RECOVERY';
  } else if (isBlocked) {
    nodes.policy.status = 'blocked';
    nodes.remediation.status = 'blocked';
    activeNodeId = 'policy';
    currentWorkflowStage = 'BLOCKED BY POLICY GATE';
  } else if (isEscalated) {
    nodes.orchestrator.status = 'failed';
    nodes.orchestrator.statusLabel = 'SAFE ESCALATION';
    activeNodeId = 'orchestrator';
    currentWorkflowStage = 'ESCALATED TO HUMAN ON-CALL';
  }

  // Derive conduits state
  const conduits: ConduitConnection[] = DEFAULT_CONDUITS.map((c) => {
    const fromStatus = nodes[c.from].status;
    const toStatus = nodes[c.to].status;
    const isActive = (fromStatus === 'active' || toStatus === 'active') ||
      (c.from === 'policy' && c.to === 'remediation' && isPendingApproval);
    
    let status: AgentNodeStatus = 'idle';
    if (fromStatus === 'failed' || toStatus === 'failed') status = 'failed';
    else if (fromStatus === 'blocked' || toStatus === 'blocked') status = 'blocked';
    else if (fromStatus === 'waiting' || toStatus === 'waiting') status = 'waiting';
    else if (fromStatus === 'active' || toStatus === 'active') status = 'active';
    else if (fromStatus === 'completed' && toStatus === 'completed') status = 'completed';

    return {
      from: c.from,
      to: c.to,
      isActive,
      status,
      label: c.label,
    };
  });

  // Calculate elapsed time from timestamps
  let elapsedMs = 0;
  if (sortedEvents.length >= 2) {
    const t0 = new Date(sortedEvents[0].timestamp).getTime();
    const tN = new Date(sortedEvents[sortedEvents.length - 1].timestamp).getTime();
    if (!isNaN(t0) && !isNaN(tN) && tN >= t0) {
      elapsedMs = tN - t0;
    }
  }

  // Extract recent events for compact timeline
  const recentEvents = sortedEvents.slice(-8).reverse().map((e) => {
    let summary = e.type.replace(/_/g, ' ');
    if (e.payload?.tool) summary = `${e.payload.tool}: ${e.payload.message || 'executed'}`;
    else if (e.payload?.reason) summary = e.payload.reason;
    else if (e.payload?.title) summary = e.payload.title;
    else if (e.payload?.summary) summary = e.payload.summary;

    return {
      sequence: e.sequence,
      eventId: e.event_id,
      type: e.type,
      actor: e.actor,
      timestamp: e.timestamp,
      summary: summary.length > 80 ? `${summary.slice(0, 77)}...` : summary,
    };
  });

  const verificationTotal = verificationChecks.length;
  const verificationPassedCount = verificationChecks.filter((c) => c.passed).length;
  const verificationFailedCount = verificationChecks.filter((c) => !c.passed).length;
  const verificationReportAvailable = verificationChecks.length > 0 || verificationPassed !== null;
  const diagnosticBudgetRemaining = Math.max(0, diagnosticsMax - diagnosticsRun);
  const remediationBudgetRemaining = Math.max(0, remediationsMax - remediationsRun);

  const telemetry: OperationalTelemetry = {
    evidenceCount: Math.max(evidenceCount, nodes.investigation.evidenceRefs.length),
    hypothesisCount,
    leadingConfidence,
    leadingHypothesis,
    diagnosticsRun,
    diagnosticsMax,
    remediationsRun,
    remediationsMax,
    verificationPassed,
    verificationChecks,
    verificationTotal,
    verificationPassedCount,
    verificationFailedCount,
    verificationReportAvailable,
    replanningCycles,
    replanningCount: replanningCycles,
    elapsedMs,
    incidentOutcome: outcome,
    policyRequiresApproval: isPendingApproval,
    policyDecision,
    remediationAction,
    remediationBudgetRemaining,
    diagnosticBudgetRemaining,
  };

  return {
    incidentId,
    scenario,
    client,
    outcome,
    currentWorkflowStage,
    activeNodeId,
    selectedNodeId: activeNodeId,
    nodes,
    conduits,
    telemetry,
    recentEvents,
    connectionStatus,
    isPendingApproval,
    isEscalated,
    isVerified,
    isBlocked,
    updatedAt: new Date().toISOString(),
  };
}

export function deriveNormalizedEngineState(
  incident: IncidentResponse | null,
  events: Event[] = [],
  investigation: InvestigationState | null = null,
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'completed' | 'idle' = 'idle'
): NormalizedEngineState {
  return normalizeEngineState(incident, investigation, events, connectionStatus);
}
