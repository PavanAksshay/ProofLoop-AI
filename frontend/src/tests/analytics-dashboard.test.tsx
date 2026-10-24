import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AnalyticsDashboard } from '../components/AnalyticsDashboard';
import { IncidentSummaryItem } from '../types';
import { computeIncidentAnalytics } from '../lib/analytics';

describe('Incident Analytics Dashboard', () => {
  const mockIncidents: IncidentSummaryItem[] = [
    {
      incident_id: 'inc-01-clean',
      scenario: 'clean_recovery',
      client: 'client_a',
      outcome: 'VERIFIED',
      summary: 'Rollback verified.',
      mode: 'proofloop',
      created_at: '2026-10-24T10:00:00Z',
      updated_at: '2026-10-24T10:02:30Z', // 150 seconds
    },
    {
      incident_id: 'inc-02-escalated',
      scenario: 'unprovable_recovery',
      client: 'client_b',
      outcome: 'ESCALATED',
      summary: 'Safely escalated after budget exhaustion.',
      mode: 'proofloop',
      created_at: '2026-10-24T10:10:00Z',
      updated_at: '2026-10-24T10:15:00Z',
    },
    {
      incident_id: 'inc-03-pending',
      scenario: 'stale_runbook',
      client: 'client_a',
      outcome: 'PENDING_APPROVAL',
      summary: 'Awaiting human authorization.',
      mode: 'proofloop',
      created_at: '2026-10-24T10:20:00Z',
      updated_at: '2026-10-24T10:20:00Z',
    },
  ];

  it('correctly derives metrics and treats missing duration telemetry gracefully', () => {
    const analytics = computeIncidentAnalytics(mockIncidents);

    expect(analytics.totalIncidents).toBe(3);
    expect(analytics.verifiedRecoveries).toBe(1);
    expect(analytics.escalatedCount).toBe(1);
    expect(analytics.pendingApprovals).toBe(1);
    expect(analytics.verifiedRecoveryRate).toBeCloseTo(1 / 3, 2);
    expect(analytics.falseSuccessRate).toBe(0.0);
    expect(analytics.policyViolationRate).toBe(0.0);
    expect(analytics.meanTimeToRecoveryMs).toBe(150000); // 150 seconds
  });

  it('handles empty incidents list without dividing by zero or crashing', () => {
    const analytics = computeIncidentAnalytics([]);

    expect(analytics.totalIncidents).toBe(0);
    expect(analytics.verifiedRecoveries).toBe(0);
    expect(analytics.verifiedRecoveryRate).toBe(0);
    expect(analytics.meanTimeToRecoveryMs).toBeNull();
  });

  it('renders KPI statistic cards with verified recovery rate and zero false-success rate', () => {
    render(
      <AnalyticsDashboard
        incidents={mockIncidents}
        isLoading={false}
        onRefresh={vi.fn()}
        onSelectIncident={vi.fn()}
        onNavigateToView={vi.fn()}
      />
    );

    expect(screen.getByText('OPERATIONAL ANALYTICS & GOVERNANCE DASHBOARD')).toBeInTheDocument();
    expect(screen.getByText('Total Incidents')).toBeInTheDocument();
    expect(screen.getByText('Verified Recovery')).toBeInTheDocument();
    expect(screen.getByText('False-Success Rate')).toBeInTheDocument();
    expect(screen.getByText('Policy Gate Violations')).toBeInTheDocument();

    // False-success rate and policy violation rate both show 0.0%
    expect(screen.getAllByText('0.0%').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('✓ Zero unverified success claims')).toBeInTheDocument();
  });

  it('filters metrics by scenario selector', () => {
    render(
      <AnalyticsDashboard
        incidents={mockIncidents}
        isLoading={false}
        onRefresh={vi.fn()}
        onSelectIncident={vi.fn()}
        onNavigateToView={vi.fn()}
      />
    );

    const scenarioSelect = screen.getByLabelText('Filter by scenario');
    fireEvent.change(scenarioSelect, { target: { value: 'clean_recovery' } });

    expect(screen.getByText('1 Records Evaluated')).toBeInTheDocument();
  });

  it('triggers onSelectIncident when clicking an item in the recent activity feed', () => {
    const onSelectIncidentMock = vi.fn();
    render(
      <AnalyticsDashboard
        incidents={mockIncidents}
        isLoading={false}
        onRefresh={vi.fn()}
        onSelectIncident={onSelectIncidentMock}
        onNavigateToView={vi.fn()}
      />
    );

    const incidentRow = screen.getByText((content) => content.startsWith('inc-01-'));
    fireEvent.click(incidentRow);

    expect(onSelectIncidentMock).toHaveBeenCalledWith('inc-01-clean');
  });
});
