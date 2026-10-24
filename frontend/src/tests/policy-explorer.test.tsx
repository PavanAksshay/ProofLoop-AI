import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PolicyDecisionExplorer } from '../components/PolicyDecisionExplorer';
import { Event } from '../types';

describe('PolicyDecisionExplorer Component', () => {
  const mockEvents: Event[] = [
    {
      event_id: 'evt-prop-1',
      incident_id: 'inc-pde-01',
      sequence: 1,
      timestamp: '2026-10-24T10:00:00Z',
      type: 'action_proposed',
      actor: 'agent',
      payload: {
        tool: 'scale_deployment',
        service: 'order-service',
        arguments: { replicas: 5 },
      },
      evidence_refs: ['metric:cpu_load'],
    },
    {
      event_id: 'evt-pol-1',
      incident_id: 'inc-pde-01',
      sequence: 2,
      timestamp: '2026-10-24T10:00:01Z',
      type: 'policy_decision',
      actor: 'system',
      payload: {
        decision: 'ALLOWED',
        rule_id: 'POL-SCALE-UP',
        reason: 'Scaling replicas within quota is pre-approved',
        tool: 'scale_deployment',
      },
      evidence_refs: [],
    },
    {
      event_id: 'evt-exec-1',
      incident_id: 'inc-pde-01',
      sequence: 3,
      timestamp: '2026-10-24T10:00:05Z',
      type: 'tool_executed',
      actor: 'system',
      payload: {
        tool: 'scale_deployment',
        success: true,
        message: 'Deployment scaled to 5 replicas',
      },
      evidence_refs: [],
    },
    {
      event_id: 'evt-verif-1',
      incident_id: 'inc-pde-01',
      sequence: 4,
      timestamp: '2026-10-24T10:00:10Z',
      type: 'verification_result',
      actor: 'system',
      payload: {
        all_passed: true,
      },
      evidence_refs: [],
    },
    // Second policy decision: APPROVAL_REQUIRED
    {
      event_id: 'evt-pol-2',
      incident_id: 'inc-pde-01',
      sequence: 5,
      timestamp: '2026-10-24T10:01:00Z',
      type: 'policy_decision',
      actor: 'system',
      payload: {
        decision: 'APPROVAL_REQUIRED',
        rule_id: 'POL-PAYMENT-GATE',
        reason: 'Restarting payment database requires manager sign-off',
        tool: 'restart_database',
      },
      evidence_refs: [],
    },
    // Third: BLOCKED
    {
      event_id: 'evt-pol-3',
      incident_id: 'inc-pde-01',
      sequence: 6,
      timestamp: '2026-10-24T10:02:00Z',
      type: 'policy_decision',
      actor: 'system',
      payload: {
        decision: 'BLOCKED',
        rule_id: 'POL-NO-FORCE-DROP',
        reason: 'Dropping database tables is permanently prohibited',
        tool: 'drop_table',
      },
      evidence_refs: [],
    },
    // Fourth: REVALIDATION_FAILED
    {
      event_id: 'evt-reject-1',
      incident_id: 'inc-pde-01',
      sequence: 7,
      timestamp: '2026-10-24T10:03:00Z',
      type: 'approval_rejected_by_policy',
      actor: 'system',
      payload: {
        rule_id: 'POL-DRIFT-DETECTED',
        reason: 'Target state drifted prior to approved execution',
        tool: 'patch_cluster',
      },
      evidence_refs: [],
    },
  ];

  it('renders explorer header and governance principle', () => {
    render(<PolicyDecisionExplorer events={mockEvents} />);

    expect(screen.getByText('POLICY DECISION EXPLORER')).toBeInTheDocument();
    expect(screen.getByText(/GOVERNANCE PRINCIPLE:/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Policy authorization allows an action to be scheduled in the synthetic simulator/i)
    ).toBeInTheDocument();
  });

  it('renders all extracted policy decision records by default', () => {
    render(<PolicyDecisionExplorer events={mockEvents} />);

    expect(screen.getByText('Rule: POL-SCALE-UP')).toBeInTheDocument();
    expect(screen.getByText('Rule: POL-PAYMENT-GATE')).toBeInTheDocument();
    expect(screen.getByText('Rule: POL-NO-FORCE-DROP')).toBeInTheDocument();
    expect(screen.getByText('Rule: POL-DRIFT-DETECTED')).toBeInTheDocument();
  });

  it('correlates ALLOWED decision with subsequent execution and verification outcomes', () => {
    render(<PolicyDecisionExplorer events={mockEvents} />);

    // In the first record:
    expect(screen.getByText('EXECUTED (SUCCESS)')).toBeInTheDocument();
    expect(screen.getByText('VERIFIED (3/3 PASSED)')).toBeInTheDocument();
  });

  it('filters by decision type correctly', () => {
    render(<PolicyDecisionExplorer events={mockEvents} />);

    // Click BLOCKED filter
    const blockedBtn = screen.getByRole('button', { name: /^BLOCKED$/i });
    fireEvent.click(blockedBtn);

    expect(screen.getByText('Rule: POL-NO-FORCE-DROP')).toBeInTheDocument();
    expect(screen.queryByText('Rule: POL-SCALE-UP')).not.toBeInTheDocument();
    expect(screen.queryByText('Rule: POL-PAYMENT-GATE')).not.toBeInTheDocument();

    // Click APPROVAL REQUIRED filter
    const approvalBtn = screen.getByRole('button', { name: /^APPROVAL REQUIRED$/i });
    fireEvent.click(approvalBtn);

    expect(screen.getByText('Rule: POL-PAYMENT-GATE')).toBeInTheDocument();
    expect(screen.queryByText('Rule: POL-NO-FORCE-DROP')).not.toBeInTheDocument();

    // Click ALL to reset
    const allBtn = screen.getByRole('button', { name: /^ALL$/i });
    fireEvent.click(allBtn);

    expect(screen.getByText('Rule: POL-SCALE-UP')).toBeInTheDocument();
    expect(screen.getByText('Rule: POL-PAYMENT-GATE')).toBeInTheDocument();
  });

  it('expands policy record to show arguments and payload details', () => {
    render(<PolicyDecisionExplorer events={mockEvents} />);

    const inspectBtns = screen.getAllByRole('button', { name: /View Evaluated Arguments/i });
    fireEvent.click(inspectBtns[0]);

    expect(screen.getByText(/Hide Evaluated Arguments/i)).toBeInTheDocument();
    expect(screen.getByText(/"replicas": 5/)).toBeInTheDocument();
  });

  it('renders empty message when no policy decisions are present', () => {
    render(<PolicyDecisionExplorer events={[]} />);

    expect(screen.getByText('No policy decisions match the selected filter.')).toBeInTheDocument();
  });
});
