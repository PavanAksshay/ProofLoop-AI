import React from 'react';
import {
  AgentNodeId,
  AgentNodeRuntimeState,
  OperationalTelemetry,
} from '../../types/agent-engine';
import {
  X,
  Cpu,
  Search,
  GitBranch,
  ShieldAlert,
  Wrench,
  CheckCircle2,
  Activity,
  Layers,
} from 'lucide-react';

interface AgentDetailsPanelProps {
  nodeId: AgentNodeId | null;
  node: AgentNodeRuntimeState | null;
  telemetry: OperationalTelemetry;
  onClose: () => void;
  className?: string;
}

const ICONS: Record<AgentNodeId, React.FC<{ className?: string }>> = {
  orchestrator: Cpu,
  investigation: Search,
  hypothesis: GitBranch,
  policy: ShieldAlert,
  remediation: Wrench,
  verification: CheckCircle2,
};

export const AgentDetailsPanel: React.FC<AgentDetailsPanelProps> = ({
  nodeId,
  node,
  telemetry,
  onClose,
  className = '',
}) => {
  if (!nodeId || !node) {
    return (
      <div
        className={`bg-[#FAF6F0] border border-[#DFD7C7] rounded p-5 flex flex-col items-center justify-center text-center text-[#6B6255] shadow-sm ${className}`}
      >
        <Layers className="w-8 h-8 mb-2 opacity-40 text-[#1C1917]" />
        <span className="text-xs font-mono font-bold text-[#1C1917]">NO NODE SELECTED</span>
        <span className="text-[11px] font-mono mt-1 text-[#6B6255]">
          Select an agent orb in the 3D scene or status rail to inspect runtime state.
        </span>
      </div>
    );
  }

  const Icon = ICONS[nodeId];

  return (
    <div
      className={`bg-[#FAF6F0] border border-[#DFD7C7] rounded flex flex-col overflow-hidden shadow-sm ${className}`}
      role="region"
      aria-label={`${node.label} Node Details`}
    >
      {/* Header */}
      <div className="px-4 py-3 bg-[#ECE6DC] border-b border-[#DFD7C7] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-[#18181B] flex items-center justify-center text-[#FAF6F0] shadow-sm">
            <Icon className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-mono font-bold uppercase text-[#1C1917]">
                {node.label}
              </h3>
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-[#DFD7C7] bg-[#FFFFFF] text-[#6B6255] font-semibold">
                {node.id.toUpperCase()}
              </span>
            </div>
            <p className="text-[10px] font-mono text-[#6B6255]">{node.stage}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-0.5 text-[9px] font-mono font-bold uppercase border rounded ${
              node.status === 'active'
                ? 'bg-teal-50 text-teal-800 border-teal-300'
                : node.status === 'completed'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                : node.status === 'waiting'
                ? 'bg-amber-100 text-amber-800 border-amber-300'
                : node.status === 'failed' || node.status === 'blocked'
                ? 'bg-rose-100 text-rose-900 border-rose-300'
                : 'bg-[#FFFFFF] text-[#6B6255] border-[#DFD7C7]'
            }`}
          >
            {node.status.toUpperCase()}
          </span>

          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[#6B6255] hover:text-[#1C1917] hover:bg-[#DFD7C7] rounded transition-colors"
            aria-label="Close details panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content Body */}
      <div className="p-4 space-y-4 overflow-y-auto max-h-[380px] bg-[#FAF6F0]">
        {/* Role & Functional Description */}
        <div>
          <div className="text-[10px] font-mono font-bold tracking-wider text-[#6B6255] uppercase mb-1">
            ARCHITECTURAL FUNCTION
          </div>
          <p className="text-xs font-mono text-[#1C1917] leading-relaxed bg-[#FFFFFF] p-3 rounded border border-[#DFD7C7] shadow-sm">
            {node.roleDescription}
          </p>
        </div>

        {/* Dynamic Node Specific Telemetry */}
        <div>
          <div className="text-[10px] font-mono font-bold tracking-wider text-[#6B6255] uppercase mb-1.5">
            NODE RUNTIME TELEMETRY
          </div>

          {nodeId === 'investigation' && (
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="bg-[#FFFFFF] p-2.5 rounded border border-[#DFD7C7] shadow-sm">
                <span className="text-[#6B6255] text-[10px] block">EVIDENCE COLLECTED</span>
                <span className="text-sm font-bold text-[#1C1917]">
                  {telemetry.evidenceCount} items
                </span>
              </div>
              <div className="bg-[#FFFFFF] p-2.5 rounded border border-[#DFD7C7] shadow-sm">
                <span className="text-[#6B6255] text-[10px] block">DIAGNOSTIC BUDGET</span>
                <span className="text-sm font-bold text-teal-700">
                  {telemetry.diagnosticBudgetRemaining ?? '3'} left
                </span>
              </div>
            </div>
          )}

          {nodeId === 'hypothesis' && (
            <div className="space-y-2 text-xs font-mono">
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-[#FFFFFF] p-2.5 rounded border border-[#DFD7C7] shadow-sm">
                  <span className="text-[#6B6255] text-[10px] block">EVALUATED THEORIES</span>
                  <span className="text-sm font-bold text-[#1C1917]">
                    {telemetry.hypothesisCount} candidate{telemetry.hypothesisCount === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="bg-[#FFFFFF] p-2.5 rounded border border-[#DFD7C7] shadow-sm">
                  <span className="text-[#6B6255] text-[10px] block">LEADING CONFIDENCE</span>
                  <span className="text-sm font-bold text-teal-700">
                    {telemetry.leadingConfidence !== null
                      ? `${Math.round(telemetry.leadingConfidence * 100)}%`
                      : 'N/A'}
                  </span>
                </div>
              </div>
              {telemetry.leadingHypothesis && (
                <div className="bg-[#FFFFFF] p-2.5 rounded border border-[#DFD7C7] text-[11px] shadow-sm">
                  <span className="text-[#6B6255] block text-[9px] uppercase font-bold">Leading Root Cause</span>
                  <span className="text-[#1C1917] font-semibold">{telemetry.leadingHypothesis}</span>
                </div>
              )}
            </div>
          )}

          {nodeId === 'policy' && (
            <div className="space-y-2 text-xs font-mono">
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-[#FFFFFF] p-2.5 rounded border border-[#DFD7C7] shadow-sm">
                  <span className="text-[#6B6255] text-[10px] block">APPROVAL REQUIRED</span>
                  <span
                    className={`text-sm font-bold ${
                      telemetry.policyRequiresApproval ? 'text-amber-700' : 'text-[#6B6255]'
                    }`}
                  >
                    {telemetry.policyRequiresApproval ? 'YES (GATE HELD)' : 'NO (AUTHORIZED)'}
                  </span>
                </div>
                <div className="bg-[#FFFFFF] p-2.5 rounded border border-[#DFD7C7] shadow-sm">
                  <span className="text-[#6B6255] text-[10px] block">POLICY DECISION</span>
                  <span
                    className={`text-sm font-bold ${
                      telemetry.policyDecision === 'allow'
                        ? 'text-emerald-700'
                        : telemetry.policyDecision === 'block'
                        ? 'text-rose-700'
                        : 'text-[#1C1917]'
                    }`}
                  >
                    {telemetry.policyDecision ? telemetry.policyDecision.toUpperCase() : 'PENDING'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {nodeId === 'remediation' && (
            <div className="space-y-2 text-xs font-mono">
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-[#FFFFFF] p-2.5 rounded border border-[#DFD7C7] shadow-sm">
                  <span className="text-[#6B6255] text-[10px] block">PROPOSED ACTION</span>
                  <span className="text-sm font-bold text-[#1C1917] truncate block">
                    {telemetry.remediationAction ?? 'None pending'}
                  </span>
                </div>
                <div className="bg-[#FFFFFF] p-2.5 rounded border border-[#DFD7C7] shadow-sm">
                  <span className="text-[#6B6255] text-[10px] block">REMEDIATION BUDGET</span>
                  <span className="text-sm font-bold text-teal-700">
                    {telemetry.remediationBudgetRemaining ?? '1'} left
                  </span>
                </div>
              </div>
            </div>
          )}

          {nodeId === 'verification' && (
            <div className="space-y-2 text-xs font-mono">
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-[#FFFFFF] p-2 rounded border border-[#DFD7C7] text-center shadow-sm">
                  <span className="text-[#6B6255] text-[9px] block">TOTAL CHECKS</span>
                  <span className="text-sm font-bold text-[#1C1917]">
                    {telemetry.verificationTotal}
                  </span>
                </div>
                <div className="bg-[#FFFFFF] p-2 rounded border border-[#DFD7C7] text-center shadow-sm">
                  <span className="text-emerald-700 text-[9px] block font-bold">PASSED</span>
                  <span className="text-sm font-bold text-emerald-700">
                    {telemetry.verificationPassedCount}
                  </span>
                </div>
                <div className="bg-[#FFFFFF] p-2 rounded border border-[#DFD7C7] text-center shadow-sm">
                  <span className="text-rose-700 text-[9px] block font-bold">FAILED</span>
                  <span className="text-sm font-bold text-rose-700">
                    {telemetry.verificationFailedCount}
                  </span>
                </div>
              </div>
              {telemetry.verificationReportAvailable && (
                <div className="bg-[#FFFFFF] p-2.5 rounded border border-[#DFD7C7] text-[10px] text-emerald-800 flex items-center gap-1.5 shadow-sm">
                  <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 text-emerald-600" />
                  <span>Authoritative independent verification report recorded.</span>
                </div>
              )}
            </div>
          )}

          {nodeId === 'orchestrator' && (
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="bg-[#FFFFFF] p-2.5 rounded border border-[#DFD7C7] shadow-sm">
                <span className="text-[#6B6255] text-[10px] block">INCIDENT OUTCOME</span>
                <span className="text-sm font-bold text-[#1C1917]">
                  {telemetry.incidentOutcome ?? 'IN_PROGRESS'}
                </span>
              </div>
              <div className="bg-[#FFFFFF] p-2.5 rounded border border-[#DFD7C7] shadow-sm">
                <span className="text-[#6B6255] text-[10px] block">REPLANNING CYCLES</span>
                <span className="text-sm font-bold text-amber-800">
                  {telemetry.replanningCount}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Latest Activity Reference */}
        <div>
          <div className="text-[10px] font-mono font-bold tracking-wider text-[#6B6255] uppercase mb-1">
            LATEST STAGE EVENT
          </div>
          {node.lastEventSummary ? (
            <div className="bg-[#FFFFFF] p-3 rounded border border-[#DFD7C7] text-xs font-mono text-[#1C1917] flex items-start gap-2 shadow-sm">
              <Activity className="w-3.5 h-3.5 text-teal-600 mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <span className="text-[10px] text-[#6B6255] block font-bold">
                  SEQUENCE #{node.lastSequence ?? '-'}
                </span>
                <span className="break-words">{node.lastEventSummary}</span>
              </div>
            </div>
          ) : (
            <div className="bg-[#FFFFFF] p-3 rounded border border-[#DFD7C7] text-[11px] font-mono text-[#6B6255] shadow-sm">
              No direct event recorded for this node in the active session.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
