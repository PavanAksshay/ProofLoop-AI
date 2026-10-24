import { describe, it, expect } from 'vitest';
import { computeIncidentAnalytics } from '../lib/analytics';
import { IncidentSummaryItem } from '../types';

describe('Analytics Integrity & Truthfulness Tests', () => {
  it('reports falseSuccessRate as null with explicit explanation when only summary data is available', () => {
    const incidents: IncidentSummaryItem[] = [
      {
        incident_id: 'inc-01',
        scenario: 'clean_recovery',
        client: 'client_a',
        outcome: 'VERIFIED',
        summary: 'Successful recovery',
        mode: 'proofloop',
        created_at: '2026-10-24T10:00:00Z',
        updated_at: '2026-10-24T10:05:00Z',
      },
    ];

    const analytics = computeIncidentAnalytics(incidents);
    expect(analytics.falseSuccessRate).toBeNull();
    expect(analytics.falseSuccessExplanation).toContain('Cannot be computed from incident summary list');
    expect(analytics.falseSuccessExplanation).toContain('remediation_history[].verification_checks');
  });

  it('reports policyViolationRate as null with explicit explanation when SSE decision history is missing', () => {
    const incidents: IncidentSummaryItem[] = [
      {
        incident_id: 'inc-01',
        scenario: 'clean_recovery',
        client: 'client_a',
        outcome: 'VERIFIED',
        summary: 'Successful recovery',
        mode: 'proofloop',
        created_at: '2026-10-24T10:00:00Z',
        updated_at: '2026-10-24T10:05:00Z',
      },
    ];

    const analytics = computeIncidentAnalytics(incidents);
    expect(analytics.policyViolationRate).toBeNull();
    expect(analytics.policyViolationExplanation).toContain('Cannot be computed from incident summary list');
    expect(analytics.policyViolationExplanation).toContain('SSE event stream');
  });

  it('returns null MTTR for invalid or reversed timestamps', () => {
    const reversedIncidents: IncidentSummaryItem[] = [
      {
        incident_id: 'inc-rev',
        scenario: 'clean_recovery',
        client: 'client_a',
        outcome: 'VERIFIED',
        summary: 'Reversed timestamps',
        mode: 'proofloop',
        created_at: '2026-10-24T10:10:00Z',
        updated_at: '2026-10-24T10:00:00Z', // updated is BEFORE created
      },
      {
        incident_id: 'inc-invalid',
        scenario: 'clean_recovery',
        client: 'client_a',
        outcome: 'VERIFIED',
        summary: 'Invalid timestamp',
        mode: 'proofloop',
        created_at: 'invalid-date',
        updated_at: '2026-10-24T10:00:00Z',
      },
    ];

    const analytics = computeIncidentAnalytics(reversedIncidents);
    expect(analytics.meanTimeToRecoveryMs).toBeNull();
    expect(analytics.recoveryDurationExplanation).toContain('No VERIFIED incidents with valid distinct timestamps');
  });

  it('excludes equal timestamps (zero duration) from MTTR calculation', () => {
    const equalTimestampIncidents: IncidentSummaryItem[] = [
      {
        incident_id: 'inc-eq',
        scenario: 'clean_recovery',
        client: 'client_a',
        outcome: 'VERIFIED',
        summary: 'Same second creation and update',
        mode: 'proofloop',
        created_at: '2026-10-24T10:00:00Z',
        updated_at: '2026-10-24T10:00:00Z',
      },
    ];

    const analytics = computeIncidentAnalytics(equalTimestampIncidents);
    expect(analytics.meanTimeToRecoveryMs).toBeNull();
  });

  it('excludes non-VERIFIED incidents from MTTR calculation', () => {
    const unverifiedIncidents: IncidentSummaryItem[] = [
      {
        incident_id: 'inc-unver',
        scenario: 'clean_recovery',
        client: 'client_a',
        outcome: 'UNVERIFIED',
        summary: 'Action passed but invariant failed',
        mode: 'proofloop',
        created_at: '2026-10-24T10:00:00Z',
        updated_at: '2026-10-24T10:05:00Z',
      },
      {
        incident_id: 'inc-esc',
        scenario: 'clean_recovery',
        client: 'client_a',
        outcome: 'ESCALATED',
        summary: 'Escalated',
        mode: 'proofloop',
        created_at: '2026-10-24T10:00:00Z',
        updated_at: '2026-10-24T10:08:00Z',
      },
    ];

    const analytics = computeIncidentAnalytics(unverifiedIncidents);
    expect(analytics.meanTimeToRecoveryMs).toBeNull();
    expect(analytics.verifiedRecoveries).toBe(0);
    expect(analytics.unverifiedOrFailed).toBe(1);
    expect(analytics.escalatedCount).toBe(1);
  });

  it('correctly calculates MTTR when valid verified incidents are present', () => {
    const validIncidents: IncidentSummaryItem[] = [
      {
        incident_id: 'inc-01',
        scenario: 'clean_recovery',
        client: 'client_a',
        outcome: 'VERIFIED',
        summary: 'First verified run',
        mode: 'proofloop',
        created_at: '2026-10-24T10:00:00Z',
        updated_at: '2026-10-24T10:01:40Z', // 100 seconds = 100,000 ms
      },
      {
        incident_id: 'inc-02',
        scenario: 'clean_recovery',
        client: 'client_b',
        outcome: 'VERIFIED',
        summary: 'Second verified run',
        mode: 'proofloop',
        created_at: '2026-10-24T11:00:00Z',
        updated_at: '2026-10-24T11:03:20Z', // 200 seconds = 200,000 ms
      },
    ];

    const analytics = computeIncidentAnalytics(validIncidents);
    expect(analytics.meanTimeToRecoveryMs).toBe(150000);
    expect(analytics.verifiedRecoveries).toBe(2);
    expect(analytics.verifiedRecoveryRate).toBe(1.0);
    expect(analytics.recoveryDurationExplanation).toContain('Computed from 2 VERIFIED incident(s)');
  });
});
