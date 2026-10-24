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

  it('marks all inferred links with provenance: inferred and protocol: null', () => {
    const multiServiceInvestigation: InvestigationState = {
      incident_id: 'inc-multi',
      symptoms: ['slow transactions'],
      step: 2,
      hypotheses: [],
      evidence: [
        {
          id: 'ev-chk',
          source: 'checkout-service.log',
          kind: 'direct_observation',
          summary: 'DB pool timeout',
          data: {},
          timestamp: '2026-10-24T10:00:00Z',
        },
        {
          id: 'ev-db',
          source: 'postgres.log',
          kind: 'direct_observation',
          summary: 'Max connections reached',
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

    const graph = inferServiceTopology(multiServiceInvestigation, 'inc-multi');

    expect(graph.links.length).toBeGreaterThan(0);
    for (const link of graph.links) {
      expect(link.provenance).toBe('inferred');
      expect(link.protocol).toBeNull();
      expect(link.rationale).toContain('Inferred from co-occurrence in telemetry');
    }
  });
});
