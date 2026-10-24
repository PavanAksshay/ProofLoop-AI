import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ActionInspector } from '../components/ActionInspector';
import { ActionDetail } from '../types';

describe('ActionInspector Component', () => {
  const baseAction: ActionDetail = {
    actionId: 'act-001',
    tool: 'rollback_config',
    service: 'checkout-service',
    attempt: 1,
    incidentId: 'inc-test-12345678',
    rationale: 'Rollback to healthy version v1.2',
    arguments: {
      target_version: 'v1.2',
      drain_timeout_seconds: 30,
    },
    supportingEvidenceRefs: ['metric:checkout_5xx_spike', 'log:checkout_null_pointer'],
    policyDecision: 'ALLOWED',
    policyRuleId: 'POL-AUTO-ROLLBACK-01',
    policyReason: 'Rollback permitted under low impact policy',
    approvalRequired: false,
    approvalState: 'none',
    executionStatus: 'success',
    executionResult: {
      status: 'completed',
      reverted_version: 'v1.2',
    },
    verificationOutcome: 'passed',
    timestamp: '2026-10-24T10:00:00Z',
    actor: 'agent',
  };

  it('renders core action details, service and rationale', () => {
    render(<ActionInspector action={baseAction} />);

    expect(screen.getByText('rollback_config')).toBeInTheDocument();
    expect(screen.getByText(/checkout-service/)).toBeInTheDocument();
    expect(screen.getByText(/Attempt #1/)).toBeInTheDocument();
    expect(screen.getByText('Rollback to healthy version v1.2')).toBeInTheDocument();
  });

  it('renders policy decision, rule and reason honestly', () => {
    render(<ActionInspector action={baseAction} />);

    expect(screen.getByText('ALLOWED')).toBeInTheDocument();
    expect(screen.getByText('POL-AUTO-ROLLBACK-01')).toBeInTheDocument();
    expect(screen.getByText(/Rollback permitted under low impact policy/)).toBeInTheDocument();
  });

  it('renders execution status and verification outcome correctly', () => {
    render(<ActionInspector action={baseAction} />);

    expect(screen.getByText('SUCCESS')).toBeInTheDocument();
    expect(screen.getByText('PASSED')).toBeInTheDocument();
  });

  it('renders structured arguments and payload correctly', () => {
    render(<ActionInspector action={baseAction} />);

    expect(screen.getByText(/target_version:/i)).toBeInTheDocument();
    expect(screen.getByText('v1.2')).toBeInTheDocument();
    expect(screen.getByText(/drain_timeout_seconds:/i)).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
  });

  it('toggles raw execution payload view', () => {
    render(<ActionInspector action={baseAction} />);

    const viewPayloadBtn = screen.getByText('View Payload');
    fireEvent.click(viewPayloadBtn);

    expect(screen.getByText('Hide Payload')).toBeInTheDocument();
    expect(screen.getByText(/"reverted_version": "v1.2"/)).toBeInTheDocument();
  });

  it('renders supporting evidence references', () => {
    render(<ActionInspector action={baseAction} />);

    expect(screen.getByText(/metric:checkout_5xx_spike/)).toBeInTheDocument();
    expect(screen.getByText(/log:checkout_null_pointer/)).toBeInTheDocument();
  });

  it('handles pending approval status with approver requirements', () => {
    const approvalAction: ActionDetail = {
      tool: 'restart_cluster',
      service: 'payment-gateway',
      policyDecision: 'APPROVAL_REQUIRED',
      policyRuleId: 'POL-HIGH-RISK-GATE',
      policyReason: 'Restarting cluster requires human authorization',
      approvalRequired: true,
      approvalState: 'pending',
      executionStatus: 'not_started',
      verificationOutcome: 'pending',
    };

    render(<ActionInspector action={approvalAction} />);

    expect(screen.getByText('APPROVAL_REQUIRED')).toBeInTheDocument();
    expect(screen.getByText('POL-HIGH-RISK-GATE')).toBeInTheDocument();
    expect(screen.getAllByText('PENDING').length).toBe(2);
    expect(screen.getByText('NOT_STARTED')).toBeInTheDocument();
  });

  it('handles gracefully missing optional fields without inventing values', () => {
    const minimalAction: ActionDetail = {
      tool: 'inspect_logs',
    };

    render(<ActionInspector action={minimalAction} />);

    expect(screen.getByText('inspect_logs')).toBeInTheDocument();
    expect(screen.getByText(/No arguments passed for this tool/i)).toBeInTheDocument();
    expect(screen.getByText('NOT EVALUATED')).toBeInTheDocument();
  });

  it('supports incident link navigation callback when enabled', () => {
    const onNav = vi.fn();
    render(
      <ActionInspector
        action={baseAction}
        showIncidentLink={true}
        onNavigateToIncident={onNav}
      />
    );

    const inspectBtn = screen.getByRole('button', { name: /^Inspect →/i });
    fireEvent.click(inspectBtn);
    expect(onNav).toHaveBeenCalledWith('inc-test-12345678');
  });
});
