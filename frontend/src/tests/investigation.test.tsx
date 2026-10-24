import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { InvestigationView } from '../components/InvestigationView';
import { IncidentResponse, InvestigationState } from '../types';

describe('InvestigationView Component', () => {
  const mockIncident: IncidentResponse = {
    incident_id: 'inc-investigation-123',
    scenario: 'stale_runbook',
    client: 'client_a',
    outcome: 'RUNNING',
    summary: 'Investigating bad deployment configuration',
    mode: 'proofloop',
    events: [],
  };

  const mockInvestigation: InvestigationState = {
    incident_id: 'inc-investigation-123',
    symptoms: ['Elevated 5xx rate', 'Checkout latency > 2000ms'],
    step: 2,
    hypotheses: [
      {
        id: 'hyp-bad-config',
        title: 'Corrupted Configuration Version',
        description: 'Service was updated with invalid connection parameters in v_bad.',
        category: 'configuration',
        confidence_score: 0.85,
        supporting_evidence_ids: ['ev-logs-1', 'ev-config-diff'],
        contradicting_evidence_ids: [],
        status: 'active',
        required_evidence: ['config:active_version'],
        applicable_diagnostics: ['inspect_config'],
        last_ranking_change_reason: 'Correlated with 500 error logs',
        suggested_diagnostic: 'inspect_config',
      },
      {
        id: 'hyp-db-pool',
        title: 'Database Connection Pool Exhaustion',
        description: 'Connection pool starved by leaked handles.',
        category: 'database',
        confidence_score: 0.25,
        supporting_evidence_ids: [],
        contradicting_evidence_ids: ['ev-db-metrics'],
        status: 'refuted',
      },
    ],
    evidence: [
      {
        id: 'ev-logs-1',
        source: 'checkout-service.log',
        kind: 'direct_observation',
        summary: 'Error: invalid connection timeout in config version v_bad',
        data: { line: 42, error_code: 500 },
        timestamp: '2026-10-24T10:00:00Z',
      },
      {
        id: 'ev-config-diff',
        source: 'config-store',
        kind: 'diagnostic_result',
        summary: 'Diff indicates v_bad deployed 10 minutes ago',
        data: { active: 'v_bad', previous: 'v_healthy' },
        timestamp: '2026-10-24T10:01:00Z',
      },
      {
        id: 'ev-db-metrics',
        source: 'database-exporter',
        kind: 'contradictory',
        summary: 'Active DB connections: 4/100 (healthy capacity)',
        data: { active: 4, max: 100 },
        timestamp: '2026-10-24T10:02:00Z',
      },
    ],
    diagnostics_performed: [
      {
        tool: 'inspect_config',
        service: 'checkout-service',
        arguments: { component: 'database' },
        success: true,
        data: { version: 'v_bad', timeout: -1 },
        timestamp: '2026-10-24T10:01:30Z',
      },
    ],
    outstanding_uncertainties: ['Is auth service also experiencing timeout errors?'],
    current_diagnosis: {
      diagnosis: 'Corrupted Configuration Version in v_bad',
      confidence: 0.85,
      confidence_basis: 'Direct log excerpts and config inspection confirmation.',
      leading_hypothesis_id: 'hyp-bad-config',
      unresolved_uncertainties: [],
    },
    remediation_history: [
      {
        id: 'rem-1',
        tool: 'rollback_config',
        service: 'checkout-service',
        arguments: { target_version: 'v_healthy' },
        attempt: 1,
        success: true,
        originating_hypothesis_id: 'hyp-bad-config',
        supporting_evidence_ids: ['ev-logs-1'],
        policy_decision: 'ALLOWED',
        execution_result: { rolled_back: true },
        verification_passed: true,
        verification_checks: [],
        timestamp: '2026-10-24T10:03:00Z',
      },
    ],
    budget: {
      max_steps: 8,
      max_diagnostics: 5,
      max_remediations: 3,
      steps_taken: 2,
      diagnostics_run: 1,
      remediations_attempted: 1,
      remediations_proposed: 1,
      remediations_blocked: 0,
      remediations_pending_approval: 0,
    },
    replanning_cycle: 0,
  };

  it('renders "No active incident selected" when both activeIncident and investigation are null', () => {
    render(
      <InvestigationView
        activeIncident={null}
        investigation={null}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByTestId('investigation-no-incident')).toBeInTheDocument();
    expect(screen.getByText('NO ACTIVE INCIDENT SELECTED')).toBeInTheDocument();
  });

  it('renders loading skeleton when isLoading is true', () => {
    render(
      <InvestigationView
        activeIncident={mockIncident}
        investigation={null}
        isLoading={true}
        error={null}
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByTestId('investigation-loading')).toBeInTheDocument();
    expect(screen.getByText(/FETCHING AUTONOMOUS INVESTIGATION STATE/i)).toBeInTheDocument();
  });

  it('renders error state with retry button on error', () => {
    const retryMock = vi.fn();
    render(
      <InvestigationView
        activeIncident={mockIncident}
        investigation={null}
        isLoading={false}
        error="Network error fetching investigation"
        onRetry={retryMock}
      />
    );

    expect(screen.getByTestId('investigation-error')).toBeInTheDocument();
    expect(screen.getByText(/FAILED TO LOAD INVESTIGATION STATE/i)).toBeInTheDocument();
    expect(screen.getByText(/Network error fetching investigation/i)).toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: /RETRY REQUEST/i });
    fireEvent.click(retryBtn);
    expect(retryMock).toHaveBeenCalledTimes(1);
  });

  it('renders empty investigation state when incident exists but no investigation state', () => {
    render(
      <InvestigationView
        activeIncident={mockIncident}
        investigation={null}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByTestId('investigation-empty')).toBeInTheDocument();
    expect(screen.getByText(/NO INVESTIGATION STATE FOR THIS INCIDENT/i)).toBeInTheDocument();
  });

  it('renders competing hypotheses, diagnosis, budget, symptoms and evidence', () => {
    render(
      <InvestigationView
        activeIncident={mockIncident}
        investigation={mockInvestigation}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />
    );

    // Header identity
    expect(screen.getByText('AUTONOMOUS INVESTIGATION COCKPIT')).toBeInTheDocument();
    expect(screen.getByText('stale_runbook')).toBeInTheDocument();

    // Budget indicators
    expect(screen.getByText('Investigation Steps')).toBeInTheDocument();
    expect(screen.getByText('Diagnostics Run')).toBeInTheDocument();
    expect(screen.getByText('Remediations Attempted')).toBeInTheDocument();

    // Leading diagnosis
    expect(screen.getByText('Corrupted Configuration Version in v_bad')).toBeInTheDocument();
    expect(screen.getByText('85% Confidence')).toBeInTheDocument();

    // Symptoms
    expect(screen.getByText('Elevated 5xx rate')).toBeInTheDocument();
    expect(screen.getByText('Checkout latency > 2000ms')).toBeInTheDocument();

    // Competing hypotheses
    expect(screen.getByText('hyp-bad-config')).toBeInTheDocument();
    expect(screen.getByText('Corrupted Configuration Version')).toBeInTheDocument();
    expect(screen.getByText('hyp-db-pool')).toBeInTheDocument();
    expect(screen.getByText('Database Connection Pool Exhaustion')).toBeInTheDocument();

    // Evidence ledger
    expect(screen.getByText('ev-logs-1')).toBeInTheDocument();
    expect(screen.getByText('ev-config-diff')).toBeInTheDocument();
    expect(screen.getByText('ev-db-metrics')).toBeInTheDocument();

    // Diagnostics executed
    expect(screen.getAllByText('inspect_config').length).toBeGreaterThan(0);

    // Remediations
    expect(screen.getByText('Attempt #1: rollback_config')).toBeInTheDocument();
  });

  it('handles partial investigation data gracefully without crashing when optional fields are omitted', () => {
    const partialInvestigation: InvestigationState = {
      incident_id: 'inc-partial-1',
      symptoms: [],
      step: 0,
      hypotheses: [
        {
          id: 'hyp-1',
          title: 'Unknown Root Cause',
          description: 'No description provided.',
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
        steps_taken: 0,
        diagnostics_run: 0,
        remediations_attempted: 0,
        remediations_proposed: 0,
        remediations_blocked: 0,
        remediations_pending_approval: 0,
      },
      replanning_cycle: 0,
    };

    render(
      <InvestigationView
        activeIncident={mockIncident}
        investigation={partialInvestigation}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByText('Unknown Root Cause')).toBeInTheDocument();
    expect(screen.getByText('No definitive diagnosis formulated yet.')).toBeInTheDocument();
  });

  it('expands evidence structured data and diagnostic telemetry on click', () => {
    render(
      <InvestigationView
        activeIncident={mockIncident}
        investigation={mockInvestigation}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />
    );

    // Toggle observation data
    const toggleEvidenceBtn = screen.getAllByRole('button', { name: /Inspect Observation Data/i })[0];
    fireEvent.click(toggleEvidenceBtn);
    expect(screen.getByText(/"error_code": 500/i)).toBeInTheDocument();

    // Toggle diagnostic telemetry
    const toggleDiagBtn = screen.getByRole('button', { name: /View Diagnostic Telemetry/i });
    fireEvent.click(toggleDiagBtn);
    expect(screen.getByText(/"version": "v_bad"/i)).toBeInTheDocument();
  });
});
