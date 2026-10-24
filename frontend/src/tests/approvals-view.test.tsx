import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ApprovalsView } from '../components/ApprovalsView';
import { IncidentResponse, IncidentSummaryItem } from '../types';

describe('ApprovalsView Component', () => {
  const mockPendingIncident: IncidentResponse = {
    incident_id: 'inc-approvals-999',
    scenario: 'stale_runbook',
    client: 'client_b',
    outcome: 'PENDING_APPROVAL',
    summary: 'Client B requires approval for configuration rollback.',
    mode: 'proofloop',
    events: [
      {
        event_id: 'evt-req-1',
        incident_id: 'inc-approvals-999',
        timestamp: '2026-10-24T10:00:00Z',
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
        evidence_refs: ['config:active_version', 'logs:checkout-service'],
      },
    ],
  };

  const mockIncidentsList: IncidentSummaryItem[] = [
    {
      incident_id: 'inc-approvals-999',
      scenario: 'stale_runbook',
      client: 'client_b',
      outcome: 'PENDING_APPROVAL',
      summary: 'Client B requires approval for configuration rollback.',
      mode: 'proofloop',
      created_at: '2026-10-24T10:00:00Z',
      updated_at: '2026-10-24T10:00:00Z',
    },
    {
      incident_id: 'inc-other-completed',
      scenario: 'clean_recovery',
      client: 'client_a',
      outcome: 'VERIFIED',
      summary: 'Completed run.',
      mode: 'proofloop',
      created_at: '2026-10-24T09:00:00Z',
      updated_at: '2026-10-24T09:05:00Z',
    },
  ];

  it('renders pending approval with proposed tool, rule_id, reason, arguments and evidence refs', () => {
    render(
      <ApprovalsView
        activeIncident={mockPendingIncident}
        incidentsList={mockIncidentsList}
        onSelectIncident={vi.fn()}
        onSubmitApproval={vi.fn()}
        isSubmitting={false}
        approvalError={null}
        lastDecisionResponse={null}
        onRefresh={vi.fn()}
        isLoading={false}
      />
    );

    expect(screen.getByText('HUMAN APPROVAL GOVERNANCE GATE')).toBeInTheDocument();
    expect(screen.getByText('ACTION REQUIRING HUMAN AUTHORIZATION')).toBeInTheDocument();
    expect(screen.getByText('rollback_config')).toBeInTheDocument();
    expect(screen.getByText('POL-CLIENT-B-ROLLBACK')).toBeInTheDocument();
    expect(screen.getByText(/"Client B requires approval for configuration rollback."/i)).toBeInTheDocument();
    expect(screen.getByText(/"target_version": "v_healthy"/i)).toBeInTheDocument();
    expect(screen.getByText('🔗 config:active_version')).toBeInTheDocument();
    expect(screen.getByText('🔗 logs:checkout-service')).toBeInTheDocument();
  });

  it('submits approve decision with identity and comment', async () => {
    const onSubmitMock = vi.fn().mockResolvedValue(undefined);
    render(
      <ApprovalsView
        activeIncident={mockPendingIncident}
        incidentsList={mockIncidentsList}
        onSelectIncident={vi.fn()}
        onSubmitApproval={onSubmitMock}
        isSubmitting={false}
        approvalError={null}
        lastDecisionResponse={null}
        onRefresh={vi.fn()}
        isLoading={false}
      />
    );

    const approveBtn = screen.getByRole('button', { name: /Authorize & Execute/i });
    fireEvent.click(approveBtn);

    expect(onSubmitMock).toHaveBeenCalledWith(
      'inc-approvals-999',
      'approve',
      'governance-reviewer',
      'Reviewed proposed action against client policy.'
    );
  });

  it('submits deny decision with identity and comment', async () => {
    const onSubmitMock = vi.fn().mockResolvedValue(undefined);
    render(
      <ApprovalsView
        activeIncident={mockPendingIncident}
        incidentsList={mockIncidentsList}
        onSelectIncident={vi.fn()}
        onSubmitApproval={onSubmitMock}
        isSubmitting={false}
        approvalError={null}
        lastDecisionResponse={null}
        onRefresh={vi.fn()}
        isLoading={false}
      />
    );

    const denyBtn = screen.getByRole('button', { name: /Reject Action/i });
    fireEvent.click(denyBtn);

    expect(onSubmitMock).toHaveBeenCalledWith(
      'inc-approvals-999',
      'deny',
      'governance-reviewer',
      'Reviewed proposed action against client policy.'
    );
  });

  it('disables submit controls during submission to prevent duplicate requests', () => {
    render(
      <ApprovalsView
        activeIncident={mockPendingIncident}
        incidentsList={mockIncidentsList}
        onSelectIncident={vi.fn()}
        onSubmitApproval={vi.fn()}
        isSubmitting={true}
        approvalError={null}
        lastDecisionResponse={null}
        onRefresh={vi.fn()}
        isLoading={false}
      />
    );

    const recordingButtons = screen.getAllByRole('button', { name: /Recording Decision.../i });
    expect(recordingButtons).toHaveLength(2);
    recordingButtons.forEach((btn) => expect(btn).toBeDisabled());
  });

  it('displays API conflict or validation error messages', () => {
    render(
      <ApprovalsView
        activeIncident={mockPendingIncident}
        incidentsList={mockIncidentsList}
        onSelectIncident={vi.fn()}
        onSubmitApproval={vi.fn()}
        isSubmitting={false}
        approvalError="Conflict: This approval request has already been processed or resolved."
        lastDecisionResponse={null}
        onRefresh={vi.fn()}
        isLoading={false}
      />
    );

    expect(
      screen.getByText(/Conflict: This approval request has already been processed or resolved./i)
    ).toBeInTheDocument();
  });

  it('displays last recorded decision feedback from server response', () => {
    const lastDecision: IncidentResponse = {
      incident_id: 'inc-approvals-999',
      scenario: 'stale_runbook',
      client: 'client_b',
      outcome: 'VERIFIED',
      summary: 'Action approved and verified successfully.',
      mode: 'proofloop',
      events: [],
    };

    render(
      <ApprovalsView
        activeIncident={null}
        incidentsList={mockIncidentsList}
        onSelectIncident={vi.fn()}
        onSubmitApproval={vi.fn()}
        isSubmitting={false}
        approvalError={null}
        lastDecisionResponse={lastDecision}
        onRefresh={vi.fn()}
        isLoading={false}
      />
    );

    expect(screen.getByText('APPROVAL DECISION RECORDED BY SERVER')).toBeInTheDocument();
    expect(screen.getByText('Action approved and verified successfully.')).toBeInTheDocument();
  });

  it('renders all clear state when no approvals are pending', () => {
    render(
      <ApprovalsView
        activeIncident={null}
        incidentsList={[]}
        onSelectIncident={vi.fn()}
        onSubmitApproval={vi.fn()}
        isSubmitting={false}
        approvalError={null}
        lastDecisionResponse={null}
        onRefresh={vi.fn()}
        isLoading={false}
      />
    );

    expect(
      screen.getByText(/All clear\. No incidents currently awaiting human authorization across the store\./i)
    ).toBeInTheDocument();
  });
});
