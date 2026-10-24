import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { IncidentsView } from '../components/IncidentsView';
import { IncidentSummaryItem } from '../types';

describe('IncidentsView Component', () => {
  const mockIncidents: IncidentSummaryItem[] = [
    {
      incident_id: 'inc-001-clean',
      scenario: 'clean_recovery',
      client: 'client_a',
      outcome: 'VERIFIED',
      summary: 'Config rollback succeeded and all 3 verifier checks passed.',
      mode: 'proofloop',
      created_at: '2026-10-24T09:00:00Z',
      updated_at: '2026-10-24T09:02:00Z',
    },
    {
      incident_id: 'inc-002-approval',
      scenario: 'stale_runbook',
      client: 'client_b',
      outcome: 'PENDING_APPROVAL',
      summary: 'Action paused waiting for authorization on database schema update.',
      mode: 'proofloop',
      created_at: '2026-10-24T09:15:00Z',
      updated_at: '2026-10-24T09:16:00Z',
    },
    {
      incident_id: 'inc-003-escalated',
      scenario: 'unprovable_recovery',
      client: 'client_a',
      outcome: 'ESCALATED',
      summary: 'Budget exhausted without verifiable recovery.',
      mode: 'fallback',
      created_at: '2026-10-24T09:30:00Z',
      updated_at: '2026-10-24T09:35:00Z',
    },
  ];

  it('renders list of incidents with scenario, client and outcome badges', () => {
    render(
      <IncidentsView
        incidents={mockIncidents}
        isLoading={false}
        selectedIncidentId={null}
        onSelectIncident={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByText('PERSISTED INCIDENT EXPLORER')).toBeInTheDocument();
    expect(screen.getByText('inc-001-clean')).toBeInTheDocument();
    expect(screen.getByText('inc-002-approval')).toBeInTheDocument();
    expect(screen.getByText('inc-003-escalated')).toBeInTheDocument();

    expect(screen.getByText('Scenario: clean_recovery')).toBeInTheDocument();
    expect(screen.getByText('Scenario: stale_runbook')).toBeInTheDocument();
  });

  it('filters incidents by text search query', () => {
    render(
      <IncidentsView
        incidents={mockIncidents}
        isLoading={false}
        selectedIncidentId={null}
        onSelectIncident={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    const searchInput = screen.getByPlaceholderText(/Search by ID, scenario, client, or summary/i);
    fireEvent.change(searchInput, { target: { value: 'client_b' } });

    expect(screen.getByText('inc-002-approval')).toBeInTheDocument();
    expect(screen.queryByText('inc-001-clean')).not.toBeInTheDocument();
    expect(screen.queryByText('inc-003-escalated')).not.toBeInTheDocument();
  });

  it('filters incidents by status filter', () => {
    render(
      <IncidentsView
        incidents={mockIncidents}
        isLoading={false}
        selectedIncidentId={null}
        onSelectIncident={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    const pendingFilterBtn = screen.getByRole('button', { name: /^PENDING APPROVAL$/i });
    fireEvent.click(pendingFilterBtn);

    expect(screen.getByText('inc-002-approval')).toBeInTheDocument();
    expect(screen.queryByText('inc-001-clean')).not.toBeInTheDocument();
    expect(screen.queryByText('inc-003-escalated')).not.toBeInTheDocument();
  });

  it('triggers onSelectIncident when clicking an incident card', () => {
    const onSelectMock = vi.fn();
    render(
      <IncidentsView
        incidents={mockIncidents}
        isLoading={false}
        selectedIncidentId={null}
        onSelectIncident={onSelectMock}
        onRefresh={vi.fn()}
      />
    );

    const firstCard = screen.getByTestId('incident-card-inc-001-clean');
    fireEvent.click(firstCard);

    expect(onSelectMock).toHaveBeenCalledWith('inc-001-clean');
  });

  it('indicates active incident in cockpit', () => {
    render(
      <IncidentsView
        incidents={mockIncidents}
        isLoading={false}
        selectedIncidentId="inc-001-clean"
        onSelectIncident={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByText('ACTIVE IN COCKPIT')).toBeInTheDocument();
  });

  it('renders loading state when isLoading is true', () => {
    render(
      <IncidentsView
        incidents={[]}
        isLoading={true}
        selectedIncidentId={null}
        onSelectIncident={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByText(/LOADING INCIDENT HISTORY/i)).toBeInTheDocument();
  });

  it('renders empty state when no incidents match', () => {
    render(
      <IncidentsView
        incidents={[]}
        isLoading={false}
        selectedIncidentId={null}
        onSelectIncident={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByText(/NO MATCHING INCIDENTS FOUND/i)).toBeInTheDocument();
  });
});
