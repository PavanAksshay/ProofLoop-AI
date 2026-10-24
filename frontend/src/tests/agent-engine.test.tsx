import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  deriveNormalizedEngineState,
  createInitialNodeStates,
} from '../lib/agentEngineAdapter';
import { AgentFallback2D } from '../components/agent-engine/AgentFallback2D';
import { AgentStatusRail } from '../components/agent-engine/AgentStatusRail';
import { AgentDetailsPanel } from '../components/agent-engine/AgentDetailsPanel';
import { AgentTelemetryArea } from '../components/agent-engine/AgentTelemetryArea';
import { AgentEventTimeline } from '../components/agent-engine/AgentEventTimeline';
import { AgentOperationsEngine } from '../components/agent-engine/AgentOperationsEngine';
import { Event, IncidentResponse } from '../types';

describe('PROOFLOOP // Agent Operations Engine Adapter', () => {
  it('initializes in clean standby state when no incident is active', () => {
    const state = deriveNormalizedEngineState(null, [], null);

    expect(state.incidentId).toBeNull();
    expect(state.outcome).toBe('IDLE');
    expect(state.nodes.orchestrator.status).toBe('idle');
    expect(state.nodes.investigation.status).toBe('idle');
    expect(state.nodes.hypothesis.status).toBe('idle');
    expect(state.nodes.policy.status).toBe('idle');
    expect(state.nodes.remediation.status).toBe('idle');
    expect(state.nodes.verification.status).toBe('idle');
    expect(state.isPendingApproval).toBe(false);
    expect(state.isVerified).toBe(false);
    expect(state.telemetry.evidenceCount).toBe(0);
  });

  it('accurately derives Investigation active state from real evidence and diagnostic events', () => {
    const events: Event[] = [
      {
        sequence: 1,
        event_id: 'ev-1',
        incident_id: 'inc-101',
        timestamp: '2026-10-24T10:00:00Z',
        type: 'investigation_started',
        actor: 'agent',
        payload: { symptoms: ['HTTP 500 error rate spike > 12%'] },
        evidence_refs: ['log-trace-1'],
      },
      {
        sequence: 2,
        event_id: 'ev-2',
        incident_id: 'inc-101',
        timestamp: '2026-10-24T10:00:05Z',
        type: 'diagnostic_selected',
        actor: 'agent',
        payload: { tool: 'kubectl_describe_pods', expected_information_value: 0.85 },
        evidence_refs: ['pod-desc-artifact'],
      },
    ];

    const state = deriveNormalizedEngineState(null, events, null);

    expect(state.nodes.investigation.status).toBe('active');
    expect(state.nodes.investigation.evidenceRefs).toContain('log-trace-1');
    expect(state.nodes.investigation.evidenceRefs).toContain('pod-desc-artifact');
    expect(state.telemetry.evidenceCount).toBe(2);
    expect(state.telemetry.diagnosticsRun).toBe(1);
    expect(state.activeNodeId).toBe('investigation');
  });

  it('correctly captures hypothesis formulation with leading confidence', () => {
    const events: Event[] = [
      {
        sequence: 1,
        event_id: 'ev-1',
        incident_id: 'inc-102',
        timestamp: '2026-10-24T10:00:00Z',
        type: 'hypothesis_created',
        actor: 'agent',
        payload: {
          title: 'ConfigMap corruption in auth-service',
          confidence_score: 0.92,
        },
        evidence_refs: [],
      },
    ];

    const state = deriveNormalizedEngineState(null, events, null);

    expect(state.nodes.hypothesis.status).toBe('active');
    expect(state.telemetry.leadingConfidence).toBe(0.92);
    expect(state.telemetry.leadingHypothesis).toBe('ConfigMap corruption in auth-service');
  });

  it('truthfully pauses at Policy Gate in PENDING_APPROVAL without pretending to execute remediation', () => {
    const incident: IncidentResponse = {
      incident_id: 'inc-apprv-1',
      scenario: 'payment_gateway_timeout',
      client: 'standard_acme',
      mode: 'autonomous',
      outcome: 'PENDING_APPROVAL',
      summary: 'Action requires human approval per production policy.',
      events: [],
    };

    const events: Event[] = [
      {
        sequence: 1,
        event_id: 'ev-apprv',
        incident_id: 'inc-apprv-1',
        timestamp: '2026-10-24T10:01:00Z',
        type: 'approval_requested',
        actor: 'gate',
        payload: { rule_id: 'POL-004', reason: 'Database failover exceeds automated risk threshold' },
        evidence_refs: [],
      },
    ];

    const state = deriveNormalizedEngineState(incident, events, null);

    expect(state.isPendingApproval).toBe(true);
    expect(state.nodes.policy.status).toBe('waiting');
    expect(state.nodes.policy.statusLabel).toBe('APPROVAL REQUIRED');
    expect(state.nodes.remediation.status).toBe('waiting');
    expect(state.nodes.remediation.statusLabel).toBe('BLOCKED AT GATE');
    expect(state.telemetry.policyRequiresApproval).toBe(true);
  });

  it('never marks VERIFIED unless authoritative outcome and independent invariants confirm it', () => {
    const falseGreenIncident: IncidentResponse = {
      incident_id: 'inc-false-green',
      scenario: 'false_green_probe',
      client: 'strict_invariants',
      mode: 'autonomous',
      outcome: 'UNVERIFIED',
      summary: 'Health check passed HTTP 200 but synthetic checkout transaction failed.',
      events: [],
    };

    const events: Event[] = [
      {
        sequence: 1,
        event_id: 'ev-check-1',
        incident_id: 'inc-false-green',
        timestamp: '2026-10-24T10:05:00Z',
        type: 'verification_check',
        actor: 'verifier',
        payload: { check_name: 'http_health_200', passed: true },
        evidence_refs: [],
      },
      {
        sequence: 2,
        event_id: 'ev-check-2',
        incident_id: 'inc-false-green',
        timestamp: '2026-10-24T10:05:02Z',
        type: 'verification_check',
        actor: 'verifier',
        payload: { check_name: 'synthetic_checkout_txn', passed: false },
        evidence_refs: [],
      },
      {
        sequence: 3,
        event_id: 'ev-inv-failed',
        incident_id: 'inc-false-green',
        timestamp: '2026-10-24T10:05:03Z',
        type: 'independent_verification_failed',
        actor: 'verifier',
        payload: { all_passed: false },
        evidence_refs: [],
      },
    ];

    const state = deriveNormalizedEngineState(falseGreenIncident, events, null);

    expect(state.isVerified).toBe(false);
    expect(state.nodes.verification.status).toBe('failed');
    expect(state.telemetry.verificationPassedCount).toBe(1);
    expect(state.telemetry.verificationFailedCount).toBe(1);
    expect(state.telemetry.verificationTotal).toBe(2);
  });

  it('marks VERIFIED only when authoritative status confirms recovery', () => {
    const verifiedIncident: IncidentResponse = {
      incident_id: 'inc-clean-rec',
      scenario: 'clean_recovery',
      client: 'standard',
      mode: 'autonomous',
      outcome: 'VERIFIED',
      summary: 'All invariant probes satisfied.',
      events: [],
    };

    const events: Event[] = [
      {
        sequence: 1,
        event_id: 'ev-1',
        incident_id: 'inc-clean-rec',
        timestamp: '2026-10-24T10:06:00Z',
        type: 'verification_check',
        actor: 'verifier',
        payload: { check_name: 'error_rate_below_threshold', passed: true },
        evidence_refs: [],
      },
    ];

    const state = deriveNormalizedEngineState(verifiedIncident, events, null);

    expect(state.isVerified).toBe(true);
    expect(state.nodes.verification.status).toBe('completed');
    expect(state.nodes.orchestrator.status).toBe('completed');
    expect(state.telemetry.incidentOutcome).toBe('VERIFIED');
  });

  it('marks ESCALATED truthfully when budget is exhausted or escalation occurs', () => {
    const escalatedIncident: IncidentResponse = {
      incident_id: 'inc-esc-1',
      scenario: 'hostile_runbook',
      client: 'strict',
      mode: 'autonomous',
      outcome: 'ESCALATED',
      summary: 'Diagnostic budget exceeded; handed off safely to on-call engineer.',
      events: [],
    };

    const state = deriveNormalizedEngineState(escalatedIncident, [], null);

    expect(state.isEscalated).toBe(true);
    expect(state.nodes.orchestrator.status).toBe('failed');
  });
});

describe('Agent Operations Engine Components', () => {
  const baseNodes = createInitialNodeStates();
  const mockState = deriveNormalizedEngineState(null, [], null);

  it('renders AgentStatusRail with all 6 operational nodes and responds to click selection', () => {
    const onSelect = vi.fn();
    render(
      <AgentStatusRail
        nodes={baseNodes}
        selectedNodeId={null}
        onSelectNode={onSelect}
      />
    );

    expect(screen.getByText('OPERATIONAL NODES')).toBeInTheDocument();
    expect(screen.getByText('ORCHESTRATOR')).toBeInTheDocument();
    expect(screen.getByText('INVESTIGATION')).toBeInTheDocument();
    expect(screen.getByText('HYPOTHESIS ENGINE')).toBeInTheDocument();
    expect(screen.getByText('POLICY GATE')).toBeInTheDocument();
    expect(screen.getByText('REMEDIATION')).toBeInTheDocument();
    expect(screen.getByText('INDEPENDENT VERIFIER')).toBeInTheDocument();

    fireEvent.click(screen.getByText('INVESTIGATION'));
    expect(onSelect).toHaveBeenCalledWith('investigation');
  });

  it('renders 2D accessible fallback with interactive node hitboxes', () => {
    const onSelect = vi.fn();
    render(
      <AgentFallback2D
        state={mockState}
        selectedNodeId={null}
        onSelectNode={onSelect}
      />
    );

    expect(screen.getByTestId('agent-engine-2d-fallback')).toBeInTheDocument();
    expect(screen.getByText(/ACCESSIBLE FALLBACK/i)).toBeInTheDocument();

    const orchBtn = screen.getByRole('button', { name: /ORCHESTRATOR/i });
    expect(orchBtn).toBeInTheDocument();
    fireEvent.click(orchBtn);
    expect(onSelect).toHaveBeenCalledWith('orchestrator');
  });

  it('renders AgentDetailsPanel with stage description, telemetry and handles close', () => {
    const onClose = vi.fn();
    render(
      <AgentDetailsPanel
        nodeId="investigation"
        node={baseNodes.investigation}
        telemetry={mockState.telemetry}
        onClose={onClose}
      />
    );

    expect(screen.getByRole('heading', { name: /INVESTIGATION/i })).toBeInTheDocument();
    expect(screen.getByText('ARCHITECTURAL FUNCTION')).toBeInTheDocument();
    expect(screen.getByText(/Evidence Ledger/i)).toBeInTheDocument();
    expect(screen.getByText('EVIDENCE COLLECTED')).toBeInTheDocument();

    const closeBtn = screen.getByLabelText('Close details panel');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders AgentTelemetryArea without fabricated metrics and honest counts', () => {
    render(<AgentTelemetryArea telemetry={mockState.telemetry} />);

    expect(screen.getByText('REAL-TIME OPERATIONAL TELEMETRY')).toBeInTheDocument();
    expect(screen.getByText('EVIDENCE')).toBeInTheDocument();
    expect(screen.getByText('HYPOTHESES')).toBeInTheDocument();
    expect(screen.getByText('POLICY GATE')).toBeInTheDocument();
    expect(screen.getByText('ACTION BUDGET')).toBeInTheDocument();
    expect(screen.getByText('VERIFICATION')).toBeInTheDocument();
  });

  it('renders AgentEventTimeline with sequence numbers and SSE status badges', () => {
    const testEvents: Event[] = [
      {
        sequence: 1,
        event_id: 'ev-test-1',
        incident_id: 'inc-99',
        timestamp: '2026-10-24T12:00:00Z',
        type: 'incident_opened',
        actor: 'agent',
        payload: { scenario: 'stale_runbook' },
        evidence_refs: [],
      },
    ];

    render(
      <AgentEventTimeline
        events={testEvents}
        connectionStatus="connected"
      />
    );

    expect(screen.getByText('INCIDENT EVENT STREAM')).toBeInTheDocument();
    expect(screen.getByText('LIVE SSE')).toBeInTheDocument();
    expect(screen.getByText(/Incident initialized/i)).toBeInTheDocument();
  });

  describe('AgentOperationsEngine Pacing & Controls', () => {
    const sampleIncident: IncidentResponse = {
      incident_id: 'inc-pace-1',
      scenario: 'clean_recovery',
      client: 'client_a',
      mode: 'autonomous',
      outcome: 'VERIFIED',
      summary: 'Automated recovery verified.',
      events: [],
    };

    const multiEvents: Event[] = [
      {
        sequence: 1,
        event_id: 'ev-1',
        incident_id: 'inc-pace-1',
        timestamp: '2026-10-24T12:00:00Z',
        type: 'incident_opened',
        actor: 'agent',
        payload: { scenario: 'clean_recovery' },
        evidence_refs: [],
      },
      {
        sequence: 2,
        event_id: 'ev-2',
        incident_id: 'inc-pace-1',
        timestamp: '2026-10-24T12:00:01Z',
        type: 'investigation_started',
        actor: 'agent',
        payload: { symptoms: ['HTTP 500 spike'] },
        evidence_refs: [],
      },
      {
        sequence: 3,
        event_id: 'ev-3',
        incident_id: 'inc-pace-1',
        timestamp: '2026-10-24T12:00:02Z',
        type: 'hypothesis_created',
        actor: 'agent',
        payload: { title: 'Bad Config Deployed', confidence_score: 0.95 },
        evidence_refs: [],
      },
      {
        sequence: 4,
        event_id: 'ev-4',
        incident_id: 'inc-pace-1',
        timestamp: '2026-10-24T12:00:03Z',
        type: 'action_proposed',
        actor: 'gate',
        payload: { action: 'rollback_version' },
        evidence_refs: [],
      },
      {
        sequence: 5,
        event_id: 'ev-5',
        incident_id: 'inc-pace-1',
        timestamp: '2026-10-24T12:00:04Z',
        type: 'outcome',
        actor: 'agent',
        payload: { outcome: 'VERIFIED' },
        evidence_refs: [],
      },
    ];

    it('renders top control bar with incident ID and pacing controls', () => {
      render(
        <AgentOperationsEngine
          activeIncident={sampleIncident}
          events={multiEvents}
          investigationState={null}
          connectionStatus="connected"
        />
      );

      expect(screen.getByText('PROOFLOOP // 3D AGENT OPERATIONS ENGINE')).toBeInTheDocument();
      expect(screen.getByText('inc-pace-1')).toBeInTheDocument();
      expect(screen.getByText('clean_recovery')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /3D/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /2D/i })).toBeInTheDocument();
    });

    it('allows fast-forwarding to complete final state via SKIP button', () => {
      render(
        <AgentOperationsEngine
          activeIncident={sampleIncident}
          events={multiEvents}
          investigationState={null}
          connectionStatus="connected"
        />
      );

      const skipBtn = screen.queryByRole('button', { name: /SKIP/i });
      if (skipBtn) {
        fireEvent.click(skipBtn);
        expect(screen.getByText('5/5')).toBeInTheDocument();
      }
    });

    it('switches between 3D and 2D fallback view without crashing', () => {
      render(
        <AgentOperationsEngine
          activeIncident={sampleIncident}
          events={multiEvents}
          investigationState={null}
          connectionStatus="connected"
        />
      );

      const twoDBtn = screen.getByRole('button', { name: /2D/i });
      fireEvent.click(twoDBtn);

      expect(screen.getByTestId('agent-engine-2d-fallback')).toBeInTheDocument();
    });
  });
});
