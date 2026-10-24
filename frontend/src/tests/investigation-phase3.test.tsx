import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { InvestigationView } from '../components/InvestigationView';
import { IncidentResponse, InvestigationState } from '../types';

describe('Phase 3 Autonomous Investigation & Recovery Proof', () => {
  const baseIncident: IncidentResponse = {
    incident_id: 'inc-phase3-001',
    scenario: 'first_fix_fails',
    client: 'client_a',
    outcome: 'RUNNING',
    summary: 'Autonomous recovery testing',
    mode: 'proofloop',
    events: [],
  };

  const createBaseInvestigation = (overrides?: Partial<InvestigationState>): InvestigationState => ({
    incident_id: 'inc-phase3-001',
    symptoms: ['Elevated error rate'],
    step: 1,
    hypotheses: [
      {
        id: 'hyp-1',
        title: 'Initial Hypothesis',
        description: 'Root cause analysis in progress.',
        category: 'infrastructure',
        confidence_score: 0.7,
        supporting_evidence_ids: [],
        contradicting_evidence_ids: [],
        status: 'active',
      },
    ],
    evidence: [],
    diagnostics_performed: [],
    outstanding_uncertainties: [],
    remediation_history: [],
    budget: {
      max_steps: 8,
      max_diagnostics: 5,
      max_remediations: 3,
      steps_taken: 1,
      diagnostics_run: 0,
      remediations_attempted: 0,
      remediations_proposed: 0,
      remediations_blocked: 0,
      remediations_pending_approval: 0,
    },
    replanning_cycle: 0,
    ...overrides,
  });

  // Test 1: evidence supporting a hypothesis renders linked badges
  it('evidence supporting a hypothesis renders linked badges', () => {
    const inv = createBaseInvestigation({
      hypotheses: [
        {
          id: 'hyp-db-leak',
          title: 'Connection Pool Starvation',
          description: 'Database pool exhaustion.',
          supporting_evidence_ids: ['ev-pool-metrics', 'ev-slow-queries'],
          contradicting_evidence_ids: [],
          status: 'active',
        },
      ],
      evidence: [
        {
          id: 'ev-pool-metrics',
          source: 'db-exporter',
          kind: 'diagnostic_result',
          summary: 'Pool connections 100/100',
          data: { active: 100 },
          timestamp: '2026-10-24T10:00:00Z',
        },
        {
          id: 'ev-slow-queries',
          source: 'postgres.log',
          kind: 'direct_observation',
          summary: 'Query timeout on checkout_orders',
          data: {},
          timestamp: '2026-10-24T10:01:00Z',
        },
      ],
    });

    render(
      <InvestigationView
        activeIncident={baseIncident}
        investigation={inv}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByText(/✓ ev-pool-metrics/)).toBeInTheDocument();
    expect(screen.getByText(/✓ ev-slow-queries/)).toBeInTheDocument();
  });

  // Test 2: evidence contradicting a hypothesis renders linked badges
  it('evidence contradicting a hypothesis renders linked badges', () => {
    const inv = createBaseInvestigation({
      hypotheses: [
        {
          id: 'hyp-auth-down',
          title: 'Auth Service Down',
          description: 'Auth failure causing cascade.',
          supporting_evidence_ids: [],
          contradicting_evidence_ids: ['ev-auth-health-200'],
          status: 'refuted',
        },
      ],
      evidence: [
        {
          id: 'ev-auth-health-200',
          source: 'health-checker',
          kind: 'contradictory',
          summary: 'Auth service ping returned 200 OK',
          data: { status: 200 },
          timestamp: '2026-10-24T10:00:00Z',
        },
      ],
    });

    render(
      <InvestigationView
        activeIncident={baseIncident}
        investigation={inv}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByText(/✕ ev-auth-health-200/)).toBeInTheDocument();
  });

  // Test 3: required evidence missing from evidence array is shown as MISSING
  it('required evidence missing from evidence array is shown as MISSING', () => {
    const inv = createBaseInvestigation({
      hypotheses: [
        {
          id: 'hyp-bad-release',
          title: 'Bad Release Rollout',
          description: 'New canary deployment has memory leak.',
          supporting_evidence_ids: [],
          contradicting_evidence_ids: [],
          required_evidence: ['ev-heap-dump', 'ev-canary-tag'],
          status: 'active',
        },
      ],
      evidence: [],
    });

    render(
      <InvestigationView
        activeIncident={baseIncident}
        investigation={inv}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByText(/✕ MISSING: ev-heap-dump/)).toBeInTheDocument();
    expect(screen.getByText(/✕ MISSING: ev-canary-tag/)).toBeInTheDocument();
  });

  // Test 4: failed diagnostic is visually distinguished from successful diagnostic
  it('failed diagnostic is visually distinguished from successful diagnostic', () => {
    const inv = createBaseInvestigation({
      diagnostics_performed: [
        {
          tool: 'inspect_config',
          service: 'checkout-service',
          arguments: {},
          success: true,
          data: { config_valid: true },
          timestamp: '2026-10-24T10:00:00Z',
        },
        {
          tool: 'probe_network_latency',
          service: 'checkout-service',
          arguments: { target: 'auth-service' },
          success: false,
          error: 'Connection timed out',
          data: {},
          timestamp: '2026-10-24T10:01:00Z',
        },
      ],
    });

    render(
      <InvestigationView
        activeIncident={baseIncident}
        investigation={inv}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByText('SUCCESS')).toBeInTheDocument();
    expect(screen.getByText('FAILED')).toBeInTheDocument();
    expect(screen.getByText(/Error: Connection timed out/)).toBeInTheDocument();
  });

  // Test 5: remediation with failed verification shows VERIFICATION FAILED badge
  it('remediation with failed verification shows VERIFICATION FAILED badge', () => {
    const inv = createBaseInvestigation({
      remediation_history: [
        {
          id: 'rem-fail-1',
          tool: 'restart_pod',
          service: 'checkout-service',
          arguments: {},
          attempt: 1,
          success: true,
          execution_result: { restarted: true },
          supporting_evidence_ids: [],
          verification_passed: false,
          verification_checks: [
            { check_name: 'error_rate_below_threshold', passed: false, observed: { rate: 0.18 } },
          ],
          timestamp: '2026-10-24T10:05:00Z',
        },
      ],
    });

    render(
      <InvestigationView
        activeIncident={baseIncident}
        investigation={inv}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />
    );

    expect(screen.getAllByText('VERIFICATION FAILED').length).toBeGreaterThan(0);
  });

  // Test 6: remediation with passed verification shows VERIFIED badge
  it('remediation with passed verification shows VERIFIED badge', () => {
    const inv = createBaseInvestigation({
      remediation_history: [
        {
          id: 'rem-pass-1',
          tool: 'rollback_config',
          service: 'checkout-service',
          arguments: { version: 'v_healthy' },
          attempt: 1,
          success: true,
          execution_result: { version: 'v_healthy' },
          supporting_evidence_ids: [],
          verification_passed: true,
          verification_checks: [
            { check_name: 'error_rate_zero', passed: true, observed: { rate: 0 } },
          ],
          timestamp: '2026-10-24T10:05:00Z',
        },
      ],
    });

    render(
      <InvestigationView
        activeIncident={baseIncident}
        investigation={inv}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />
    );

    expect(screen.getAllByText('VERIFIED').length).toBeGreaterThan(0);
    expect(screen.getByTestId('recovery-verified-banner')).toBeInTheDocument();
  });

  // Test 7: replanning cycle > 0 shows adaptive recovery narrative section
  it('replanning cycle > 0 shows adaptive recovery narrative section', () => {
    const inv = createBaseInvestigation({
      replanning_cycle: 2,
      remediation_history: [
        {
          id: 'rem-1',
          tool: 'rollback_config',
          service: 'checkout-service',
          arguments: {},
          attempt: 1,
          success: true,
          execution_result: {},
          supporting_evidence_ids: [],
          verification_passed: false,
          verification_checks: [],
          replanning_reason: 'First fix insufficient: downstream DB pool still starved',
          timestamp: '2026-10-24T10:02:00Z',
        },
        {
          id: 'rem-2',
          tool: 'modify_database',
          service: 'database',
          arguments: { pool_size: 200 },
          attempt: 2,
          success: true,
          execution_result: {},
          supporting_evidence_ids: [],
          verification_passed: true,
          verification_checks: [],
          timestamp: '2026-10-24T10:04:00Z',
        },
      ],
    });

    render(
      <InvestigationView
        activeIncident={baseIncident}
        investigation={inv}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />
    );

    const adaptiveSection = screen.getByTestId('adaptive-recovery-section');
    expect(adaptiveSection).toBeInTheDocument();
    expect(screen.getByText(/Adaptive Recovery Narrative/i)).toBeInTheDocument();
    expect(within(adaptiveSection).getByText(/First fix insufficient: downstream DB pool still starved/i)).toBeInTheDocument();
  });

  // Test 8: verification checks breakdown renders per-invariant results
  it('verification checks breakdown renders per-invariant results', () => {
    const inv = createBaseInvestigation({
      remediation_history: [
        {
          id: 'rem-1',
          tool: 'clear_cache',
          service: 'checkout-service',
          arguments: {},
          attempt: 1,
          success: true,
          execution_result: {},
          supporting_evidence_ids: [],
          verification_passed: false,
          verification_checks: [
            { check_name: 'error_rate', passed: false, observed: { rate: 0.15 } },
            { check_name: 'latency_p99', passed: true, observed: { ms: 120 } },
          ],
          timestamp: '2026-10-24T10:06:00Z',
        },
      ],
    });

    render(
      <InvestigationView
        activeIncident={baseIncident}
        investigation={inv}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByText('error_rate')).toBeInTheDocument();
    expect(screen.getByText('latency_p99')).toBeInTheDocument();
    expect(screen.getByTestId('recovery-not-proven-banner')).toBeInTheDocument();
    expect(screen.getByText(/RECOVERY NOT PROVEN/i)).toBeInTheDocument();
  });

  // Test 9: no success claim when escalated without verification
  it('no success claim when escalated without verification', () => {
    const inv = createBaseInvestigation({
      escalation_reason: 'Retry budget exhausted after 3 attempts without recovery proof',
      remediation_history: [
        {
          id: 'rem-1',
          tool: 'retry_operation',
          service: 'cloud-gateway',
          arguments: {},
          attempt: 1,
          success: false,
          execution_result: {},
          supporting_evidence_ids: [],
          verification_passed: null,
          verification_checks: [],
          timestamp: '2026-10-24T10:07:00Z',
        },
      ],
    });

    render(
      <InvestigationView
        activeIncident={{
          ...baseIncident,
          outcome: 'ESCALATED',
        }}
        investigation={inv}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByText(/TERMINATION REASON:/i)).toBeInTheDocument();
    expect(screen.getByText(/Retry budget exhausted/i)).toBeInTheDocument();
    expect(screen.queryByTestId('recovery-verified-banner')).not.toBeInTheDocument();
    expect(screen.queryByText(/✓ RECOVERY VERIFIED:/i)).not.toBeInTheDocument();
  });
});
