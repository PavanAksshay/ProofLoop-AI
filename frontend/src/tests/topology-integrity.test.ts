import { describe, it, expect } from 'vitest';
import { inferServiceTopology } from '../lib/topology';
import { InvestigationState } from '../types';

describe('Service Topology Integrity & Evidence Provenance Tests', () => {
  it('returns hasSufficientTelemetry: false and no invented nodes when investigation is empty', () => {
    const emptyInvestigation: InvestigationState = {
      incident_id: 'inc-empty',
      symptoms: [],
      step: 0,
      hypotheses: [],
      evidence: [],
      diagnostics_performed: [],
      outstanding_uncertainties: [],
      remediation_history: [],
      budget: {
        max_steps: 10,
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

    const graph = inferServiceTopology(emptyInvestigation, 'inc-empty');

    expect(graph.hasSufficientTelemetry).toBe(false);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.links).toHaveLength(0);
    expect(graph.unavailableReason).toBeDefined();
  });

  it('does NOT mark a service healthy solely because a diagnostic executed successfully', () => {
    const diagInvestigation: InvestigationState = {
      incident_id: 'inc-diag',
      symptoms: ['latency spike'],
      step: 1,
      hypotheses: [],
      evidence: [],
      diagnostics_performed: [
        {
          tool: 'ping_service',
          service: 'auth-service',
          arguments: {},
          success: true, // tool invocation succeeded
          data: { status: 'responding' },
          timestamp: '2026-10-24T10:00:00Z',
        },
      ],
      outstanding_uncertainties: [],
      remediation_history: [],
      budget: {
        max_steps: 10,
        max_diagnostics: 5,
        max_remediations: 3,
        steps_taken: 1,
        diagnostics_run: 1,
        remediations_attempted: 0,
        remediations_proposed: 0,
        remediations_blocked: 0,
        remediations_pending_approval: 0,
      },
      replanning_cycle: 0,
    };

    const graph = inferServiceTopology(diagInvestigation, 'inc-diag');

    const authNode = graph.nodes.find((n) => n.id === 'auth-service');
    expect(authNode).toBeDefined();
    // Honest representation: probe running without error does not prove service is healthy
    expect(authNode?.status).toBe('unknown');
    expect(authNode?.provenance).toBe('observed');
    expect(authNode?.statusRationale).toContain('Diagnostic tool');
    expect(authNode?.statusRationale).toContain('Health not independently verified');
  });

  it('marks service healthy only when independent recovery verifier confirms it', () => {
    const verifiedInvestigation: InvestigationState = {
      incident_id: 'inc-ver',
      symptoms: ['db connections high'],
      step: 2,
      hypotheses: [],
      evidence: [],
      diagnostics_performed: [],
      outstanding_uncertainties: [],
      remediation_history: [
        {
          id: 'rem-1',
          tool: 'scale_pool',
          service: 'database',
          arguments: {},
          attempt: 1,
          success: true,
          execution_result: {},
          supporting_evidence_ids: [],
          verification_passed: true, // Independent verification passed
          verification_checks: [{ check: 'invariant_healthy', passed: true }],
          timestamp: '2026-10-24T10:05:00Z',
        },
      ],
      budget: {
        max_steps: 10,
        max_diagnostics: 5,
        max_remediations: 3,
        steps_taken: 2,
        diagnostics_run: 0,
        remediations_attempted: 1,
        remediations_proposed: 1,
        remediations_blocked: 0,
        remediations_pending_approval: 0,
      },
      replanning_cycle: 0,
    };

    const graph = inferServiceTopology(verifiedInvestigation, 'inc-ver');
    const dbNode = graph.nodes.find((n) => n.id === 'database');

    expect(dbNode).toBeDefined();
    expect(dbNode?.status).toBe('healthy');
    expect(dbNode?.provenance).toBe('observed');
    expect(dbNode?.statusRationale).toContain('Independent recovery verifier confirmed');
  });

  it('does NOT inject unobserved standard nodes like edge-gateway or checkout-service', () => {
    const singleServiceInvestigation: InvestigationState = {
      incident_id: 'inc-single',
      symptoms: ['custom worker error'],
      step: 1,
      hypotheses: [],
      evidence: [
        {
          id: 'ev-1',
          source: 'auth.log',
          kind: 'direct_observation',
          summary: 'Token validation failure',
          data: {},
          timestamp: '2026-10-24T10:00:00Z',
        },
      ],
      diagnostics_performed: [],
      outstanding_uncertainties: [],
      remediation_history: [],
      budget: {
        max_steps: 10,
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
    };

    const graph = inferServiceTopology(singleServiceInvestigation, 'inc-single');

    // Only auth-service should exist — no edge-gateway or checkout-service injected
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].id).toBe('auth-service');
    expect(graph.nodes.some((n) => n.id === 'edge-gateway')).toBe(false);
    expect(graph.nodes.some((n) => n.id === 'checkout-service')).toBe(false);
  });

  it('proves that unrelated co-occurring services do NOT produce dependency edges', () => {
    const unrelatedServicesInvestigation: InvestigationState = {
      incident_id: 'inc-unrelated',
      symptoms: ['multiple isolated anomalies'],
      step: 2,
      hypotheses: [],
      evidence: [
        {
          id: 'ev-auth-isolated',
          source: 'auth.log',
          kind: 'direct_observation',
          summary: 'Token signature verification expired for local key',
          data: {},
          timestamp: '2026-10-24T10:00:00Z',
        },
        {
          id: 'ev-pg-isolated',
          source: 'postgres.log',
          kind: 'direct_observation',
          summary: 'WAL checkpoint disk flush completed in 42ms',
          data: {},
          timestamp: '2026-10-24T10:00:05Z',
        },
      ],
      diagnostics_performed: [],
      outstanding_uncertainties: [],
      remediation_history: [],
      budget: {
        max_steps: 10,
        max_diagnostics: 5,
        max_remediations: 3,
        steps_taken: 2,
        diagnostics_run: 0,
        remediations_attempted: 0,
        remediations_proposed: 0,
        remediations_blocked: 0,
        remediations_pending_approval: 0,
      },
      replanning_cycle: 0,
    };

    const graph = inferServiceTopology(unrelatedServicesInvestigation, 'inc-unrelated');

    // Both nodes exist because telemetry was observed for each
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes.some((n) => n.id === 'auth-service')).toBe(true);
    expect(graph.nodes.some((n) => n.id === 'database')).toBe(true);

    // CRITICAL: Co-occurrence alone MUST NOT establish a dependency edge
    expect(graph.links).toHaveLength(0);
  });

  it('creates evidence-backed links with evidenceRefs, rationale, and null protocol when interaction is observed', () => {
    const interactionInvestigation: InvestigationState = {
      incident_id: 'inc-interaction',
      symptoms: ['slow transactions'],
      step: 2,
      hypotheses: [],
      evidence: [
        {
          id: 'ev-chk-timeout',
          source: 'checkout-service.log',
          kind: 'direct_observation',
          summary: 'connection timeout to db:5432 pool exhausted',
          data: {},
          timestamp: '2026-10-24T10:00:00Z',
        },
        {
          id: 'ev-db-conns',
          source: 'postgres.log',
          kind: 'direct_observation',
          summary: 'Max connections reached: 100/100',
          data: {},
          timestamp: '2026-10-24T10:00:10Z',
        },
      ],
      diagnostics_performed: [],
      outstanding_uncertainties: [],
      remediation_history: [],
      budget: {
        max_steps: 10,
        max_diagnostics: 5,
        max_remediations: 3,
        steps_taken: 2,
        diagnostics_run: 0,
        remediations_attempted: 0,
        remediations_proposed: 0,
        remediations_blocked: 0,
        remediations_pending_approval: 0,
      },
      replanning_cycle: 0,
    };

    const graph = inferServiceTopology(interactionInvestigation, 'inc-interaction');

    expect(graph.links).toHaveLength(1);
    const link = graph.links[0];
    expect(link.source).toBe('checkout-service');
    expect(link.target).toBe('database');
    expect(link.provenance).toBe('inferred');
    expect(link.protocol).toBeNull(); // Protocol is never fabricated
    expect(link.evidenceRefs).toContain('ev-chk-timeout');
    expect(link.rationale).toContain('ev-chk-timeout');
    expect(link.rationale).toContain('checkout-service to database');
  });
});
