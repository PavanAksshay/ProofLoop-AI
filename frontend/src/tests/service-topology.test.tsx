import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ServiceTopologyExplorer } from '../components/ServiceTopologyExplorer';
import { InvestigationState } from '../types';
import { inferServiceTopology } from '../lib/topology';

describe('Service Topology & Root-Cause Explorer', () => {
  const mockInvestigation: InvestigationState = {
    incident_id: 'inc-topo-001',
    symptoms: ['Checkout HTTP 500 error rate > 15%'],
    step: 2,
    hypotheses: [
      {
        id: 'hyp-db-pool',
        title: 'Postgres Connection Starvation',
        description: 'Exhausted pool handles.',
        category: 'database',
        confidence_score: 0.92,
        supporting_evidence_ids: ['ev-pg-logs'],
        contradicting_evidence_ids: [],
        status: 'active',
      },
    ],
    evidence: [
      {
        id: 'ev-pg-logs',
        source: 'postgres.log',
        kind: 'direct_observation',
        summary: 'too many connections for role',
        data: {},
        timestamp: '2026-10-24T10:00:00Z',
      },
      {
        id: 'ev-checkout-logs',
        source: 'checkout-service.log',
        kind: 'direct_observation',
        summary: 'connection timeout to db:5432',
        data: {},
        timestamp: '2026-10-24T10:01:00Z',
      },
      {
        id: 'ev-gw-logs',
        source: 'edge-gateway.log',
        kind: 'direct_observation',
        summary: 'upstream HTTP 500 from checkout-service',
        data: {},
        timestamp: '2026-10-24T10:01:30Z',
      },
    ],
    diagnostics_performed: [
      {
        tool: 'probe_pool_status',
        service: 'database',
        arguments: {},
        success: false,
        error: 'Connection pool exhausted',
        data: {},
        timestamp: '2026-10-24T10:02:00Z',
      },
    ],
    outstanding_uncertainties: [],
    current_diagnosis: {
      diagnosis: 'Database pool exhaustion',
      confidence: 0.92,
      confidence_basis: 'Observed connection logs and probe errors',
      leading_hypothesis_id: 'hyp-db-pool',
      unresolved_uncertainties: [],
    },
    remediation_history: [
      {
        id: 'rem-1',
        tool: 'modify_database',
        service: 'database',
        arguments: { max_connections: 100 },
        attempt: 1,
        success: true,
        execution_result: {},
        supporting_evidence_ids: ['ev-pg-logs'],
        verification_passed: true,
        verification_checks: [],
        timestamp: '2026-10-24T10:05:00Z',
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

  it('infers service nodes, health statuses, and links from diagnostics and evidence', () => {
    const graph = inferServiceTopology(mockInvestigation, 'inc-topo-001');

    expect(graph.hasSufficientTelemetry).toBe(true);
    expect(graph.nodes.some((n) => n.id === 'database')).toBe(true);
    expect(graph.nodes.some((n) => n.id === 'checkout-service')).toBe(true);
    expect(graph.nodes.some((n) => n.id === 'edge-gateway')).toBe(true);

    const dbNode = graph.nodes.find((n) => n.id === 'database');
    expect(dbNode?.isSuspectedRootCause).toBe(true);
    expect(dbNode?.isRemediationTarget).toBe(true);
    expect(dbNode?.provenance).toBe('observed');
    expect(dbNode?.status).toBe('healthy'); // independent verification passed

    expect(graph.links.length).toBeGreaterThan(0);
    expect(graph.links.every((l) => l.provenance === 'inferred')).toBe(true);
    expect(graph.links.every((l) => l.protocol === null)).toBe(true);
  });

  it('renders honest unavailable state when investigation is null', () => {
    render(
      <ServiceTopologyExplorer
        investigation={null}
        incidentId="inc-empty"
      />
    );

    expect(screen.getByTestId('topology-unavailable')).toBeInTheDocument();
    expect(screen.getByText('SERVICE TOPOLOGY TELEMETRY UNAVAILABLE')).toBeInTheDocument();
  });

  it('renders topology node cards, suspected root-cause badge, and service inspector', () => {
    render(
      <ServiceTopologyExplorer
        investigation={mockInvestigation}
        incidentId="inc-topo-001"
        scenario="first_fix_fails"
      />
    );

    expect(screen.getByTestId('service-topology-explorer')).toBeInTheDocument();
    expect(screen.getByText('SERVICE TOPOLOGY & ROOT-CAUSE EXPLORER')).toBeInTheDocument();
    expect(screen.getByText('LEADING SUSPECTED ROOT CAUSE')).toBeInTheDocument();

    // Select database node
    const dbCard = screen.getByTestId('topology-node-database');
    fireEvent.click(dbCard);

    expect(screen.getByText('Inspected Service')).toBeInTheDocument();
    expect(screen.getByText('probe_pool_status')).toBeInTheDocument();
  });
});
