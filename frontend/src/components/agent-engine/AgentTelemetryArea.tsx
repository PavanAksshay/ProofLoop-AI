import React from 'react';
import { OperationalTelemetry } from '../../types/agent-engine';
import {
  FileText,
  GitBranch,
  ShieldAlert,
  Wrench,
  CheckCircle2,
  Clock,
  Activity,
} from 'lucide-react';

interface AgentTelemetryAreaProps {
  telemetry: OperationalTelemetry;
  className?: string;
}

export const AgentTelemetryArea: React.FC<AgentTelemetryAreaProps> = ({
  telemetry,
  className = '',
}) => {
  return (
    <div
      className={`bg-[#FAF6F0] border border-[#DFD7C7] rounded p-3 text-xs font-mono select-none shadow-sm ${className}`}
      role="region"
      aria-label="Agent Operations Telemetry"
    >
      <div className="flex items-center justify-between border-b border-[#DFD7C7] pb-2 mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-teal-700" />
          <span className="font-bold tracking-wider text-[#1C1917] uppercase text-[11px]">
            REAL-TIME OPERATIONAL TELEMETRY
          </span>
        </div>
        <span className="text-[10px] text-[#6B6255]">
          SOURCE: AUTHORITATIVE ENGINE STATE
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {/* Evidence Count */}
        <div className="bg-[#FFFFFF] border border-[#DFD7C7] rounded p-2.5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between text-[#6B6255] text-[10px] mb-1">
            <span className="uppercase tracking-wider font-bold">EVIDENCE</span>
            <FileText className="w-3.5 h-3.5 text-teal-600" />
          </div>
          <div className="text-base font-bold text-[#1C1917]">
            {telemetry.evidenceCount}
            <span className="text-[10px] font-normal text-[#6B6255] ml-1">items</span>
          </div>
          <span className="text-[9px] text-[#6B6255] mt-0.5 truncate">
            {telemetry.evidenceCount > 0 ? 'Verified artifacts' : 'Awaiting ingest'}
          </span>
        </div>

        {/* Hypotheses Count & Top Confidence */}
        <div className="bg-[#FFFFFF] border border-[#DFD7C7] rounded p-2.5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between text-[#6B6255] text-[10px] mb-1">
            <span className="uppercase tracking-wider font-bold">HYPOTHESES</span>
            <GitBranch className="w-3.5 h-3.5 text-teal-600" />
          </div>
          <div className="text-base font-bold text-[#1C1917]">
            {telemetry.hypothesisCount}
            <span className="text-[10px] font-normal text-teal-700 ml-1 font-bold">
              {telemetry.leadingConfidence !== null
                ? `(${Math.round(telemetry.leadingConfidence * 100)}%)`
                : ''}
            </span>
          </div>
          <span className="text-[9px] text-[#6B6255] mt-0.5 truncate">
            {telemetry.leadingHypothesis ? telemetry.leadingHypothesis : 'No theories yet'}
          </span>
        </div>

        {/* Policy Decision */}
        <div className="bg-[#FFFFFF] border border-[#DFD7C7] rounded p-2.5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between text-[#6B6255] text-[10px] mb-1">
            <span className="uppercase tracking-wider font-bold">POLICY GATE</span>
            <ShieldAlert
              className={`w-3.5 h-3.5 ${
                telemetry.policyRequiresApproval
                  ? 'text-amber-600'
                  : telemetry.policyDecision === 'block'
                  ? 'text-rose-600'
                  : 'text-teal-600'
              }`}
            />
          </div>
          <div
            className={`text-base font-bold truncate ${
              telemetry.policyRequiresApproval
                ? 'text-amber-700'
                : telemetry.policyDecision === 'block'
                ? 'text-rose-700'
                : telemetry.policyDecision === 'allow'
                ? 'text-emerald-700'
                : 'text-[#1C1917]'
            }`}
          >
            {telemetry.policyRequiresApproval
              ? 'GATE HELD'
              : telemetry.policyDecision
              ? telemetry.policyDecision.toUpperCase()
              : 'IDLE'}
          </div>
          <span className="text-[9px] text-[#6B6255] mt-0.5 truncate">
            {telemetry.policyRequiresApproval ? 'Human sign-off' : 'Deterministic check'}
          </span>
        </div>

        {/* Remediation Budget */}
        <div className="bg-[#FFFFFF] border border-[#DFD7C7] rounded p-2.5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between text-[#6B6255] text-[10px] mb-1">
            <span className="uppercase tracking-wider font-bold">ACTION BUDGET</span>
            <Wrench className="w-3.5 h-3.5 text-teal-600" />
          </div>
          <div className="text-base font-bold text-[#1C1917]">
            {telemetry.remediationBudgetRemaining !== null
              ? `${telemetry.remediationBudgetRemaining}`
              : '1'}
            <span className="text-[10px] font-normal text-[#6B6255] ml-1">remaining</span>
          </div>
          <span className="text-[9px] text-[#6B6255] mt-0.5 truncate">
            {telemetry.remediationAction ?? 'Simulated sandbox'}
          </span>
        </div>

        {/* Verification Check Rate */}
        <div className="bg-[#FFFFFF] border border-[#DFD7C7] rounded p-2.5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between text-[#6B6255] text-[10px] mb-1">
            <span className="uppercase tracking-wider font-bold">VERIFICATION</span>
            <CheckCircle2
              className={`w-3.5 h-3.5 ${
                telemetry.verificationFailedCount > 0
                  ? 'text-rose-600'
                  : telemetry.verificationPassedCount > 0
                  ? 'text-emerald-600'
                  : 'text-[#6B6255]'
              }`}
            />
          </div>
          <div className="text-base font-bold flex items-center gap-1">
            <span className="text-emerald-700">{telemetry.verificationPassedCount}</span>
            <span className="text-[#6B6255]">/</span>
            <span className="text-[#1C1917]">{telemetry.verificationTotal}</span>
            {telemetry.verificationFailedCount > 0 && (
              <span className="text-[10px] font-bold text-rose-700 ml-0.5">
                ({telemetry.verificationFailedCount} fail)
              </span>
            )}
          </div>
          <span className="text-[9px] text-[#6B6255] mt-0.5 truncate">
            {telemetry.verificationTotal > 0 ? 'Independent checks' : 'Awaiting checks'}
          </span>
        </div>

        {/* Lifecycle Outcome */}
        <div className="bg-[#FFFFFF] border border-[#DFD7C7] rounded p-2.5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between text-[#6B6255] text-[10px] mb-1">
            <span className="uppercase tracking-wider font-bold">OUTCOME</span>
            <Clock className="w-3.5 h-3.5 text-teal-600" />
          </div>
          <div
            className={`text-base font-bold truncate ${
              telemetry.incidentOutcome === 'VERIFIED'
                ? 'text-emerald-700'
                : telemetry.incidentOutcome === 'PENDING_APPROVAL'
                ? 'text-amber-700'
                : telemetry.incidentOutcome === 'BLOCKED' || telemetry.incidentOutcome === 'ESCALATED'
                ? 'text-rose-700'
                : 'text-[#1C1917]'
            }`}
          >
            {telemetry.incidentOutcome ?? 'IN_PROGRESS'}
          </div>
          <span className="text-[9px] text-[#6B6255] mt-0.5 truncate">
            {(telemetry.replanningCount ?? 0) > 0
              ? `${telemetry.replanningCount} replanning loops`
              : 'Standard path'}
          </span>
        </div>
      </div>
    </div>
  );
};
