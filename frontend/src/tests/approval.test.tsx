import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ApprovalCard } from '../components/ApprovalCard';
import { Event } from '../types';

describe('ApprovalCard Component', () => {
  const mockPendingEvent: Event = {
    event_id: 'pending-evt-123',
    incident_id: 'inc-test-999',
    timestamp: '2026-10-23T10:00:00Z',
    type: 'approval_requested',
    actor: 'system',
    payload: {
      tool: 'rollback_config',
      service: 'checkout-service',
      rule_id: 'POL-CLIENT-B-ROLLBACK',
      reason: 'Client B requires approval for configuration rollback.',
      arguments: {
        target_version: 'v_healthy',
      },
      attempt: 1,
    },
    evidence_refs: ['config:checkout-service'],
  };

  it('renders proposed tool, rule, reason and arguments', () => {
    render(
      <ApprovalCard
        incidentId="inc-test-999"
        pendingEvent={mockPendingEvent}
        onSubmitApproval={vi.fn()}
        isSubmitting={false}
        approvalError={null}
      />
    );

    expect(screen.getByText('HUMAN APPROVAL REQUIRED')).toBeInTheDocument();
    expect(screen.getByText('rollback_config')).toBeInTheDocument();
    expect(screen.getByText('POL-CLIENT-B-ROLLBACK')).toBeInTheDocument();
    expect(screen.getByText(/"Client B requires approval for configuration rollback."/i)).toBeInTheDocument();
    expect(screen.getByText(/"target_version": "v_healthy"/i)).toBeInTheDocument();
    expect(
      screen.getByText(/The synthetic service simulator has NOT been mutated/i)
    ).toBeInTheDocument();
  });

  it('submits approve decision with audit identity', () => {
    const onSubmitMock = vi.fn();
    render(
      <ApprovalCard
        incidentId="inc-test-999"
        pendingEvent={mockPendingEvent}
        onSubmitApproval={onSubmitMock}
        isSubmitting={false}
        approvalError={null}
      />
    );

    const approveBtn = screen.getByRole('button', { name: /Authorize & Execute/i });
    fireEvent.click(approveBtn);

    expect(onSubmitMock).toHaveBeenCalledWith(
      'approve',
      'demo-reviewer',
      'Reviewed proposed change in dashboard'
    );
  });

  it('submits deny decision with audit identity', () => {
    const onSubmitMock = vi.fn();
    render(
      <ApprovalCard
        incidentId="inc-test-999"
        pendingEvent={mockPendingEvent}
        onSubmitApproval={onSubmitMock}
        isSubmitting={false}
        approvalError={null}
      />
    );

    const denyBtn = screen.getByRole('button', { name: /Reject Action/i });
    fireEvent.click(denyBtn);

    expect(onSubmitMock).toHaveBeenCalledWith(
      'deny',
      'demo-reviewer',
      'Reviewed proposed change in dashboard'
    );
  });

  it('disables controls while request is in flight', () => {
    render(
      <ApprovalCard
        incidentId="inc-test-999"
        pendingEvent={mockPendingEvent}
        onSubmitApproval={vi.fn()}
        isSubmitting={true}
        approvalError={null}
      />
    );

    const buttons = screen.getAllByRole('button', { name: /Recording Decision.../i });
    expect(buttons).toHaveLength(2);
    buttons.forEach((btn) => expect(btn).toBeDisabled());
  });

  it('displays HTTP 409 conflict error clearly when approval was already resolved', () => {
    render(
      <ApprovalCard
        incidentId="inc-test-999"
        pendingEvent={mockPendingEvent}
        onSubmitApproval={vi.fn()}
        isSubmitting={false}
        approvalError="Conflict: This approval request has already been processed or resolved."
      />
    );

    expect(
      screen.getByText(/Conflict: This approval request has already been processed or resolved./i)
    ).toBeInTheDocument();
  });
});
