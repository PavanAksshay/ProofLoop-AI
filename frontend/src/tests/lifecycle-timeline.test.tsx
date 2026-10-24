import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ActionLifecycleTimeline } from '../components/ActionLifecycleTimeline';
import { Event } from '../types';

describe('ActionLifecycleTimeline Component', () => {
  const completeLifecycleEvents: Event[] = [
    {
      event_id: 'evt-prop-1',
      incident_id: 'inc-life-01',
      sequence: 1,
      timestamp: '2026-10-24T10:00:00Z',
      type: 'action_proposed',
      actor: 'agent',
      payload: {
        tool: 'rollback_config',
        service: 'checkout-service',
        arguments: { version: 'v_healthy' },
        rationale: 'Revert to known good deployment',
        attempt: 1,
      },
      evidence_refs: ['metric:5xx_spike'],
    },
    {
      event_id: 'evt-pol-1',
      incident_id: 'inc-life-01',
      sequence: 2,
      timestamp: '2026-10-24T10:00:02Z',
      type: 'policy_decision',
      actor: 'system',
      payload: {
        decision: 'ALLOWED',
        rule_id: 'POL-SAFE-ROLLBACK',
        reason: 'Authorized automatic rollback',
        tool: 'rollback_config',
      },
      evidence_refs: [],
    },
    {
      event_id: 'evt-exec-1',
      incident_id: 'inc-life-01',
      sequence: 3,
      timestamp: '2026-10-24T10:00:06Z',
      type: 'tool_executed',
      actor: 'system',
      payload: {
        tool: 'rollback_config',
        success: true,
        message: 'Config version restored',
      },
      evidence_refs: [],
    },
    {
      event_id: 'evt-verif-1',
      incident_id: 'inc-life-01',
      sequence: 4,
      timestamp: '2026-10-24T10:00:15Z',
      type: 'verification_result',
      actor: 'system',
      payload: {
        all_passed: true,
      },
      evidence_refs: [],
    },
    {
      event_id: 'evt-out-1',
      incident_id: 'inc-life-01',
      sequence: 5,
      timestamp: '2026-10-24T10:00:20Z',
      type: 'outcome',
      actor: 'system',
      payload: {
        outcome: 'VERIFIED',
        summary: 'Incident resolved with verified recovery',
      },
      evidence_refs: [],
    },
  ];

  it('renders empty placeholder when no action lifecycle events exist', () => {
    render(<ActionLifecycleTimeline events={[]} />);

    expect(screen.getByText('NO ACTION LIFECYCLE EVENTS RECORDED')).toBeInTheDocument();
    expect(screen.getByText(/Start a run in Live Operations/i)).toBeInTheDocument();
  });

  it('renders complete sequential stages for successful action', () => {
    render(<ActionLifecycleTimeline events={completeLifecycleEvents} />);

    expect(screen.getByText('ACTION GOVERNANCE LIFECYCLE')).toBeInTheDocument();
    expect(screen.getByText('1. Action Proposed')).toBeInTheDocument();
    expect(screen.getByText('2. Policy Gate Evaluation')).toBeInTheDocument();
    expect(screen.getByText('4. Synthetic Execution')).toBeInTheDocument();
    expect(screen.getByText('5. Independent Recovery Verification')).toBeInTheDocument();
    expect(screen.getByText('6. Terminal Incident Outcome')).toBeInTheDocument();
  });

  it('renders blocked policy gate correctly with BLOCKED status', () => {
    const blockedEvents: Event[] = [
      {
        event_id: 'evt-prop-blocked',
        incident_id: 'inc-life-02',
        sequence: 1,
        timestamp: '2026-10-24T10:00:00Z',
        type: 'action_proposed',
        actor: 'agent',
        payload: {
          tool: 'drop_database',
          service: 'core-db',
          arguments: { force: true },
        },
        evidence_refs: [],
      },
      {
        event_id: 'evt-pol-blocked',
        incident_id: 'inc-life-02',
        sequence: 2,
        timestamp: '2026-10-24T10:00:02Z',
        type: 'policy_decision',
        actor: 'system',
        payload: {
          decision: 'BLOCKED',
          rule_id: 'POL-PROHIBIT-DROP',
          reason: 'Database drop operations are permanently prohibited.',
          tool: 'drop_database',
        },
        evidence_refs: [],
      },
    ];

    render(<ActionLifecycleTimeline events={blockedEvents} />);

    expect(screen.getByText('1. Action Proposed')).toBeInTheDocument();
    expect(screen.getByText('2. Policy Gate Evaluation')).toBeInTheDocument();
    expect(screen.getByText('BLOCKED')).toBeInTheDocument();
    expect(
      screen.getByText(/Gate Decision: BLOCKED \[Rule: POL-PROHIBIT-DROP\]/i)
    ).toBeInTheDocument();
  });

  it('renders human authorization stage with approval or rejection', () => {
    const approvalEvents: Event[] = [
      {
        event_id: 'evt-prop-app',
        incident_id: 'inc-life-03',
        sequence: 1,
        timestamp: '2026-10-24T10:00:00Z',
        type: 'action_proposed',
        actor: 'agent',
        payload: {
          tool: 'restart_cluster',
          service: 'checkout-service',
        },
        evidence_refs: [],
      },
      {
        event_id: 'evt-req-app',
        incident_id: 'inc-life-03',
        sequence: 2,
        timestamp: '2026-10-24T10:00:02Z',
        type: 'approval_requested',
        actor: 'system',
        payload: {
          tool: 'restart_cluster',
          rule_id: 'POL-CLUSTER-RESTART',
        },
        evidence_refs: [],
      },
      {
        event_id: 'evt-dec-app',
        incident_id: 'inc-life-03',
        sequence: 3,
        timestamp: '2026-10-24T10:00:10Z',
        type: 'human_approval_decision',
        actor: 'human',
        payload: {
          decision: 'approve',
          approver_id: 'sec-ops-lead',
          comment: 'Approved for incident recovery',
        },
        evidence_refs: [],
      },
    ];

    render(<ActionLifecycleTimeline events={approvalEvents} />);

    expect(screen.getByText('3. Human Authorization')).toBeInTheDocument();
    expect(
      screen.getByText(/Human Decision: APPROVE by sec-ops-lead/i)
    ).toBeInTheDocument();
  });

  it('allows multi-attempt tab switching when multiple attempts occurred', () => {
    const multiAttemptEvents: Event[] = [
      {
        event_id: 'evt-prop-att1',
        incident_id: 'inc-life-04',
        sequence: 1,
        timestamp: '2026-10-24T10:00:00Z',
        type: 'action_proposed',
        actor: 'agent',
        payload: {
          tool: 'restart_pod',
          service: 'checkout-service',
          attempt: 1,
        },
        evidence_refs: [],
      },
      {
        event_id: 'evt-prop-att2',
        incident_id: 'inc-life-04',
        sequence: 2,
        timestamp: '2026-10-24T10:02:00Z',
        type: 'action_proposed',
        actor: 'agent',
        payload: {
          tool: 'rollback_config',
          service: 'checkout-service',
          attempt: 2,
        },
        evidence_refs: [],
      },
    ];

    render(<ActionLifecycleTimeline events={multiAttemptEvents} />);

    // Both attempt tabs should be visible
    expect(screen.getByRole('button', { name: /#1: restart_pod/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /#2: rollback_config/i })).toBeInTheDocument();

    // Switch to attempt 1
    const att1Btn = screen.getByRole('button', { name: /#1: restart_pod/i });
    fireEvent.click(att1Btn);

    expect(screen.getByText(/Investigator proposed restart_pod/i)).toBeInTheDocument();
  });

  it('toggles expansion of stage payload details', () => {
    render(<ActionLifecycleTimeline events={completeLifecycleEvents} />);

    const viewPayloadBtns = screen.getAllByRole('button', { name: /View Stage Payload/i });
    fireEvent.click(viewPayloadBtns[0]);

    expect(screen.getByText(/Hide Stage Payload/i)).toBeInTheDocument();
    expect(screen.getByText(/"version": "v_healthy"/)).toBeInTheDocument();
  });
});
