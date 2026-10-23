import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { VerificationPanel } from '../components/VerificationPanel';
import { VerificationCheck, VerificationReport } from '../types';

describe('VerificationPanel Component', () => {
  it('renders all three independent verification checks in pending state initially', () => {
    render(
      <VerificationPanel
        report={null}
        latestChecks={[]}
      />
    );

    expect(screen.getByText('Independent Recovery Verification')).toBeInTheDocument();
    expect(screen.getByText('Awaiting Verification')).toBeInTheDocument();
    expect(screen.getByText('1. Synthetic Checkout Transactions')).toBeInTheDocument();
    expect(screen.getByText('2. Error-Rate Threshold Window')).toBeInTheDocument();
    expect(screen.getByText('3. Configuration & Dependency Health')).toBeInTheDocument();
    expect(
      screen.getByText(/A green HTTP 200 service health endpoint is/i)
    ).toBeInTheDocument();
  });

  it('renders all three independent checks with observed values when passed', () => {
    const passedReport: VerificationReport = {
      all_passed: true,
      checks: [
        {
          check_name: 'synthetic_checkout',
          passed: true,
          observed: { requested: 5, succeeded: 5, failed: 0 },
        },
        {
          check_name: 'error_rate_window',
          passed: true,
          observed: { error_rate: 0.0, threshold: 0.05 },
        },
        {
          check_name: 'configuration_and_dependencies',
          passed: true,
          observed: {
            active_config: 'v_healthy',
            expected_config: 'v_healthy',
            dependencies_healthy: true,
            process_running: true,
          },
        },
      ],
    };

    render(
      <VerificationPanel
        report={passedReport}
        latestChecks={passedReport.checks}
        healthStatus={200}
        finalOutcome="VERIFIED"
      />
    );

    expect(screen.getByText('✓ 3/3 Checks Passed')).toBeInTheDocument();
    expect(screen.getByText('VERIFIED')).toBeInTheDocument();

    // Check 1 observed
    expect(screen.getAllByText('5').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Requested:/i)).toBeInTheDocument();
    expect(screen.getByText(/Succeeded:/i)).toBeInTheDocument();
    // Check 2 observed
    expect(screen.getByText(/Observed Error Rate:/i)).toBeInTheDocument();
    expect(screen.getByText(/0%/i)).toBeInTheDocument();
    // Check 3 observed
    expect(screen.getAllByText('v_healthy').length).toBeGreaterThanOrEqual(1);
  });

  it('catches false-green scenario: rejects recovery and never displays VERIFIED when checkout fails', () => {
    const falseGreenChecks: VerificationCheck[] = [
      {
        check_name: 'synthetic_checkout',
        passed: false,
        observed: { requested: 5, succeeded: 0, failed: 5 },
      },
      {
        check_name: 'error_rate_window',
        passed: false,
        observed: { error_rate: 1.0, threshold: 0.05 },
      },
      {
        check_name: 'configuration_and_dependencies',
        passed: true,
        observed: {
          active_config: 'v_healthy',
          expected_config: 'v_healthy',
          dependencies_healthy: true,
          process_running: true,
        },
      },
    ];

    const failedReport: VerificationReport = {
      all_passed: false,
      checks: falseGreenChecks,
    };

    render(
      <VerificationPanel
        report={failedReport}
        latestChecks={falseGreenChecks}
        healthStatus={200}
        finalOutcome="UNVERIFIED"
      />
    );

    // Verifier must show failed status
    expect(screen.getByText('✕ Verification Failed')).toBeInTheDocument();

    // False green callout must be visible explaining why HTTP 200 is insufficient
    expect(screen.getByText(/False-Green Caught:/i)).toBeInTheDocument();
    expect(
      screen.getByText(/The service process returned HTTP 200 on its basic health check, but the independent checkout probe recorded 5 failed transactions./i)
    ).toBeInTheDocument();

    // Must show UNVERIFIED, and must NOT show VERIFIED badge
    expect(screen.getByText('UNVERIFIED')).toBeInTheDocument();
    expect(screen.queryByText('✓ 3/3 Checks Passed')).not.toBeInTheDocument();
    expect(screen.queryByText('VERIFIED')).not.toBeInTheDocument();
  });
});
