import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventTimeline } from '../components/EventTimeline';
import { Event } from '../types';

describe('EventTimeline Component', () => {
  it('renders structured summaries for adaptive recovery and investigation events', () => {
    const mockEvents: Event[] = [
      {
        event_id: 'ev-1',
        incident_id: 'inc-100',
        timestamp: '2026-10-24T10:00:00Z',
        type: 'investigation_started',
        actor: 'system',
        payload: { step_limit: 8, action_limit: 3, incident_scope: ['checkout-service'] },
        evidence_refs: [],
      },
      {
        event_id: 'ev-2',
        incident_id: 'inc-100',
        timestamp: '2026-10-24T10:00:01Z',
        type: 'hypothesis_created',
        actor: 'agent',
        payload: { id: 'hyp-bad-config', category: 'configuration', description: 'Faulty config deployed', likelihood_score: 0.8 },
        evidence_refs: [],
      },
      {
        event_id: 'ev-3',
        incident_id: 'inc-100',
        timestamp: '2026-10-24T10:00:02Z',
        type: 'diagnostic_selected',
        actor: 'agent',
        payload: { tool: 'compare_config', target_hypothesis_id: 'hyp-bad-config', eiv_score: 0.65 },
        evidence_refs: [],
      },
      {
        event_id: 'ev-4',
        incident_id: 'inc-100',
        timestamp: '2026-10-24T10:00:03Z',
        type: 'remediation_evaluation_started',
        actor: 'system',
        payload: { remediation_id: 'rem-1', tool: 'rollback_config', attempt: 1, replanning_cycle: 0 },
        evidence_refs: [],
      },
      {
        event_id: 'ev-5',
        incident_id: 'inc-100',
        timestamp: '2026-10-24T10:00:04Z',
        type: 'independent_verification_failed',
        actor: 'verifier',
        payload: { remediation_id: 'rem-1', tool: 'rollback_config', all_passed: false, failed_checks: ['synthetic_checkout', 'configuration_and_dependencies'] },
        evidence_refs: [],
      },
      {
        event_id: 'ev-6',
        incident_id: 'inc-100',
        timestamp: '2026-10-24T10:00:05Z',
        type: 'replanning_started',
        actor: 'agent',
        payload: { cycle: 1, reason: 'Verification failed after rollback_config: synthetic_checkout', remaining_remediation_budget: 2 },
        evidence_refs: [],
      },
      {
        event_id: 'ev-7',
        incident_id: 'inc-100',
        timestamp: '2026-10-24T10:00:06Z',
        type: 'new_remediation_proposed',
        actor: 'agent',
        payload: { tool: 'modify_database', cycle: 1, rationale: 'Repair degraded connection pool' },
        evidence_refs: [],
      },
    ];

    render(
      <EventTimeline
        events={mockEvents}
        connectionStatus="connected"
        incidentId="inc-100"
      />
    );

    // Verify structured summaries are present
    expect(screen.getByText(/Investigation initiated \(step limit: 8, action limit: 3\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Formulated hypothesis \[hyp-bad-config\]: Faulty config deployed \(likelihood: 80%\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Selected diagnostic: compare_config targeting hyp-bad-config/i)).toBeInTheDocument();
    expect(screen.getByText(/Evaluating actual recovery for remediation: rollback_config/i)).toBeInTheDocument();
    expect(screen.getByText(/Independent verification failed after rollback_config: \[synthetic_checkout, configuration_and_dependencies\]/i)).toBeInTheDocument();
    expect(screen.getByText(/Adaptive replanning started \(cycle 1\): Verification failed after rollback_config: synthetic_checkout/i)).toBeInTheDocument();
    expect(screen.getByText(/Adaptive remediation proposed: modify_database for cycle 1/i)).toBeInTheDocument();
  });
});
