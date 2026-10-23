import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { VerificationCheck, VerificationReport } from '../types';

interface VerificationPanelProps {
  report: VerificationReport | null;
  latestChecks: VerificationCheck[];
  healthStatus?: number;
  finalOutcome?: string;
}

export const VerificationPanel: React.FC<VerificationPanelProps> = ({
  report,
  latestChecks,
  healthStatus,
  finalOutcome,
}) => {
  const checksMap = new Map<string, VerificationCheck>();
  (report?.checks || latestChecks).forEach((c) => {
    checksMap.set(c.check_name, c);
  });

  const checkoutCheck = checksMap.get('synthetic_checkout');
  const errorRateCheck = checksMap.get('error_rate_window');
  const configCheck = checksMap.get('configuration_and_dependencies');

  const hasAnyChecks = checksMap.size > 0;
  const allPassed = report
    ? report.all_passed
    : Array.from(checksMap.values()).every((c) => c.passed) && checksMap.size === 3;

  return (
    <div className="panel" data-testid="verification-panel">
      <div className="panel-header">
        <h2 className="panel-title">
          <ShieldCheck className="w-4 h-4 text-cyan-600" />
          <span>Independent Recovery Verification</span>
        </h2>
        {hasAnyChecks ? (
          <span className={`badge font-mono text-xs ${allPassed ? 'badge-emerald' : 'badge-rose'}`}>
            {allPassed ? '✓ 3/3 Checks Passed' : '✕ Verification Failed'}
          </span>
        ) : (
          <span className="badge badge-synthetic font-mono text-xs">Awaiting Verification</span>
        )}
      </div>

      {/* Critical Verifier Invariant Warning */}
      <div className="p-3.5 bg-[#FAF6F0] border-l-4 border-[#0E7490] border border-[#DFD7C7] text-xs text-[#575044] leading-relaxed font-mono">
        <strong className="text-[#0E7490] block font-bold mb-1">VERIFIER INVARIANT:</strong>
        A green HTTP 200 service health endpoint is <em>insufficient</em> to verify recovery. Real service recovery requires independent, synthetic end-to-end checkout validation, an error-rate time window, and healthy dependencies.
      </div>

      {/* 3 Independent Checks Grid - Sharp Technical Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Check 1: Synthetic Checkout Probes */}
        <div
          className={`p-3.5 border transition-all ${
            checkoutCheck
              ? checkoutCheck.passed
                ? 'border-emerald-300 bg-emerald-50/40'
                : 'border-red-300 bg-red-50/40'
              : 'border-[#DFD7C7] bg-[#ECE6DC]'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#1C1917]">
              1. Synthetic Checkout Transactions
            </span>
            {checkoutCheck ? (
              checkoutCheck.passed ? (
                <span className="badge badge-emerald font-mono text-[10px]">PASSED</span>
              ) : (
                <span className="badge badge-rose font-mono text-[10px]">FAILED</span>
              )
            ) : (
              <span className="badge badge-synthetic font-mono text-[10px]">PENDING</span>
            )}
          </div>
          <div className="text-xs text-zinc-600 font-mono leading-relaxed">
            {checkoutCheck?.observed ? (
              <div>
                Requested: <strong>{checkoutCheck.observed.requested ?? 5}</strong>
                <br />
                Succeeded:{' '}
                <strong className={checkoutCheck.passed ? 'text-emerald-700' : 'text-red-700'}>
                  {checkoutCheck.observed.succeeded ?? 0}
                </strong>
                <br />
                Failed: <strong>{checkoutCheck.observed.failed ?? 0}</strong>
              </div>
            ) : (
              'Probes actual checkout transactions against simulated service.'
            )}
          </div>
        </div>

        {/* Check 2: Error Rate Window */}
        <div
          className={`p-3.5 border transition-all ${
            errorRateCheck
              ? errorRateCheck.passed
                ? 'border-emerald-300 bg-emerald-50/40'
                : 'border-red-300 bg-red-50/40'
              : 'border-[#DFD7C7] bg-[#ECE6DC]'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#1C1917]">
              2. Error-Rate Threshold Window
            </span>
            {errorRateCheck ? (
              errorRateCheck.passed ? (
                <span className="badge badge-emerald font-mono text-[10px]">PASSED</span>
              ) : (
                <span className="badge badge-rose font-mono text-[10px]">FAILED</span>
              )
            ) : (
              <span className="badge badge-synthetic font-mono text-[10px]">PENDING</span>
            )}
          </div>
          <div className="text-xs text-[#575044] font-mono leading-relaxed">
            {errorRateCheck?.observed ? (
              <div>
                Observed Error Rate:{' '}
                <strong className={errorRateCheck.passed ? 'text-emerald-700' : 'text-red-700'}>
                  {Math.round((errorRateCheck.observed.error_rate ?? 0) * 100)}%
                </strong>
                <br />
                Threshold: &le;{' '}
                {Math.round((errorRateCheck.observed.threshold ?? 0.05) * 100)}% over window
              </div>
            ) : (
              'Asserts error rate falls below 5% for the observation window.'
            )}
          </div>
        </div>

        {/* Check 3: Configuration & Dependencies */}
        <div
          className={`p-3.5 border transition-all ${
            configCheck
              ? configCheck.passed
                ? 'border-emerald-300 bg-emerald-50/40'
                : 'border-red-300 bg-red-50/40'
              : 'border-[#DFD7C7] bg-[#ECE6DC]'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#1C1917]">
              3. Configuration & Dependency Health
            </span>
            {configCheck ? (
              configCheck.passed ? (
                <span className="badge badge-emerald font-mono text-[10px]">PASSED</span>
              ) : (
                <span className="badge badge-rose font-mono text-[10px]">FAILED</span>
              )
            ) : (
              <span className="badge badge-synthetic font-mono text-[10px]">PENDING</span>
            )}
          </div>
          <div className="text-xs text-zinc-600 font-mono leading-relaxed">
            {configCheck?.observed ? (
              <div>
                Config: <span className="font-bold text-zinc-900">{configCheck.observed.active_config}</span>
                <br />
                Expected: <span className="font-bold">{configCheck.observed.expected_config}</span>
                <br />
                Deps: {configCheck.observed.dependencies_healthy ? 'Healthy' : 'Degraded'} | Proc:{' '}
                {configCheck.observed.process_running ? 'Running' : 'Stopped'}
              </div>
            ) : (
              'Confirms active config matches expected healthy version and dependencies are up.'
            )}
          </div>
        </div>
      </div>

      {/* Observation on false green vs actual state */}
      {healthStatus === 200 && checkoutCheck && !checkoutCheck.passed && (
        <div className="p-3 bg-red-50 border-l-4 border-red-600 text-xs text-red-900 font-mono leading-relaxed">
          🚨 <strong>False-Green Caught:</strong> The service process returned HTTP 200 on its basic health check,
          but the independent checkout probe recorded {checkoutCheck.observed.failed} failed transactions.
          The verifier prevented false recovery.
        </div>
      )}

      {/* Terminal Outcome Banner */}
      {finalOutcome && (
        <div className="flex justify-between items-center pt-3 border-t border-zinc-200 text-xs font-mono">
          <span className="text-zinc-500 uppercase tracking-wider">Recorded Terminal Outcome:</span>
          <span
            className={`badge font-mono text-xs ${
              finalOutcome === 'VERIFIED'
                ? 'badge-emerald'
                : finalOutcome === 'BLOCKED'
                ? 'badge-rose'
                : finalOutcome === 'ESCALATED'
                ? 'badge-amber'
                : 'badge-synthetic'
            }`}
          >
            {finalOutcome}
          </span>
        </div>
      )}
    </div>
  );
};
