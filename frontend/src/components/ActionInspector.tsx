import React, { useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Terminal,
  User,
  Clock,
} from 'lucide-react';
import { ActionDetail } from '../types';

interface ActionInspectorProps {
  action: ActionDetail;
  className?: string;
  showIncidentLink?: boolean;
  onNavigateToIncident?: (incidentId: string) => void;
}

export const ActionInspector: React.FC<ActionInspectorProps> = ({
  action,
  className = '',
  showIncidentLink = false,
  onNavigateToIncident,
}) => {
  const [showRawArgs, setShowRawArgs] = useState(false);
  const [showRawExecution, setShowRawExecution] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  const copyIncidentId = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 1500);
  };

  const args = action.arguments || {};
  const hasArgs = Object.keys(args).length > 0;
  const execResult = action.executionResult || {};
  const hasExecResult = Object.keys(execResult).length > 0;

  return (
    <div
      className={`panel border border-[#DFD7C7] bg-[#FAF6F0] p-4 flex flex-col gap-4 text-xs font-mono ${className}`}
      data-testid="action-inspector"
    >
      {/* Action Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#DFD7C7] pb-3">
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="w-7 h-7 bg-[#1C1917] text-[#FAF6F0] flex items-center justify-center font-mono">
            <Terminal className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-sm text-[#1C1917] uppercase tracking-wide">
                {action.tool}
              </span>
              <span className="badge badge-synthetic font-mono text-[10px]">
                Service: {action.service || 'checkout-service'}
              </span>
              {action.attempt !== undefined && (
                <span className="badge badge-synthetic font-mono text-[10px]">
                  Attempt #{action.attempt}
                </span>
              )}
            </div>
            {action.rationale && (
              <p className="text-[11px] text-[#6B6255] font-sans mt-0.5 leading-normal">
                {action.rationale}
              </p>
            )}
          </div>
        </div>

        {/* Incident identity */}
        {action.incidentId && (
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <span className="text-[11px] text-[#827869]">
              Incident: <strong className="text-[#1C1917]">{action.incidentId.slice(0, 10)}...</strong>
            </span>
            <button
              type="button"
              onClick={(e) => copyIncidentId(action.incidentId!, e)}
              className="text-[#827869] hover:text-[#1C1917] p-0.5"
              title="Copy Incident ID"
              aria-label="Copy Incident ID"
            >
              {copiedId ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
            </button>
            {showIncidentLink && onNavigateToIncident && (
              <button
                type="button"
                onClick={() => onNavigateToIncident(action.incidentId!)}
                className="text-[10px] text-[#0E7490] hover:underline uppercase font-bold"
              >
                Inspect &rarr;
              </button>
            )}
          </div>
        )}
      </div>

      {/* Grid: Policy Gate, Approval Status, Execution Status, Verification Outcome */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {/* 1. Policy Decision */}
        <div className="bg-[#ECE6DC] p-3 border border-[#DFD7C7] flex flex-col justify-between">
          <div>
            <span className="text-[10px] text-[#6B6255] uppercase tracking-wider block mb-1">
              Policy Gate Decision
            </span>
            <div className="flex items-center gap-1.5">
              <span
                className={`badge font-mono text-[10px] ${
                  action.policyDecision === 'ALLOWED'
                    ? 'badge-emerald'
                    : action.policyDecision === 'APPROVAL_REQUIRED'
                    ? 'badge-amber'
                    : action.policyDecision === 'BLOCKED' || action.policyDecision === 'REVALIDATION_FAILED'
                    ? 'badge-rose'
                    : 'badge-synthetic'
                }`}
              >
                {action.policyDecision || 'NOT EVALUATED'}
              </span>
            </div>
          </div>
          {action.policyRuleId && (
            <div className="text-[10px] text-[#575044] mt-2 pt-1.5 border-t border-[#DFD7C7]">
              Rule: <strong className="text-[#1C1917]">{action.policyRuleId}</strong>
            </div>
          )}
        </div>

        {/* 2. Approval Status */}
        <div className="bg-[#ECE6DC] p-3 border border-[#DFD7C7] flex flex-col justify-between">
          <div>
            <span className="text-[10px] text-[#6B6255] uppercase tracking-wider block mb-1">
              Human Approval
            </span>
            <span
              className={`badge font-mono text-[10px] ${
                action.approvalState === 'approved'
                  ? 'badge-emerald'
                  : action.approvalState === 'denied'
                  ? 'badge-rose'
                  : action.approvalState === 'pending'
                  ? 'badge-amber'
                  : 'badge-synthetic'
              }`}
            >
              {action.approvalState ? action.approvalState.toUpperCase() : action.approvalRequired ? 'REQUIRED' : 'NONE REQUIRED'}
            </span>
          </div>
          {action.approverId && (
            <div className="text-[10px] text-[#575044] mt-2 pt-1.5 border-t border-[#DFD7C7]">
              By: <strong className="text-[#1C1917]">{action.approverId}</strong>
            </div>
          )}
        </div>

        {/* 3. Execution Status */}
        <div className="bg-[#ECE6DC] p-3 border border-[#DFD7C7] flex flex-col justify-between">
          <div>
            <span className="text-[10px] text-[#6B6255] uppercase tracking-wider block mb-1">
              Execution Status
            </span>
            <span
              className={`badge font-mono text-[10px] ${
                action.executionStatus === 'success'
                  ? 'badge-emerald'
                  : action.executionStatus === 'failed'
                  ? 'badge-rose'
                  : action.executionStatus === 'running'
                  ? 'badge-cyan'
                  : 'badge-synthetic'
              }`}
            >
              {action.executionStatus ? action.executionStatus.toUpperCase() : 'PENDING'}
            </span>
          </div>
          <div className="text-[10px] text-[#827869] mt-2 pt-1.5 border-t border-[#DFD7C7]">
            Synthetic simulator only
          </div>
        </div>

        {/* 4. Verification Outcome */}
        <div className="bg-[#ECE6DC] p-3 border border-[#DFD7C7] flex flex-col justify-between">
          <div>
            <span className="text-[10px] text-[#6B6255] uppercase tracking-wider block mb-1">
              Recovery Verification
            </span>
            <span
              className={`badge font-mono text-[10px] ${
                action.verificationOutcome === 'passed'
                  ? 'badge-emerald'
                  : action.verificationOutcome === 'failed'
                  ? 'badge-rose'
                  : action.verificationOutcome === 'inconclusive'
                  ? 'badge-amber'
                  : 'badge-synthetic'
              }`}
            >
              {action.verificationOutcome ? action.verificationOutcome.toUpperCase() : 'AWAITING VERIFIER'}
            </span>
          </div>
          <div className="text-[10px] text-[#827869] mt-2 pt-1.5 border-t border-[#DFD7C7]">
            Independent verifier matrix
          </div>
        </div>
      </div>

      {/* Policy Reason & Invariant Notes */}
      {action.policyReason && (
        <div className="bg-[#FAF6F0] p-3 border border-[#DFD7C7] flex flex-col gap-1">
          <span className="text-[10px] text-[#6B6255] uppercase tracking-wider">Policy Gate Reason:</span>
          <p className="text-xs text-[#1C1917] font-sans italic leading-relaxed">
            "{action.policyReason}"
          </p>
        </div>
      )}

      {/* Structured Action Arguments */}
      <div className="bg-[#ECE6DC] p-3 border border-[#DFD7C7] flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <span className="text-[10px] text-[#6B6255] uppercase tracking-wider">
            Action Arguments ({hasArgs ? Object.keys(args).length : 0})
          </span>
          {hasArgs && (
            <button
              type="button"
              onClick={() => setShowRawArgs(!showRawArgs)}
              className="text-[10px] text-[#0E7490] hover:underline flex items-center gap-0.5"
            >
              {showRawArgs ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <span>{showRawArgs ? 'Hide Raw JSON' : 'Inspect Raw JSON'}</span>
            </button>
          )}
        </div>

        {!hasArgs ? (
          <span className="text-[#827869] italic">No arguments passed for this tool.</span>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {Object.entries(args).map(([k, v]) => (
              <div key={k} className="bg-[#FAF6F0] p-2 border border-[#DFD7C7] flex flex-col">
                <span className="text-[10px] text-[#827869] uppercase font-bold">{k}:</span>
                <span className="text-xs font-bold text-[#1C1917] break-all">
                  {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                </span>
              </div>
            ))}
          </div>
        )}

        {hasArgs && (
          <pre className="payload-json text-[11px] mt-1 p-2 bg-[#FAF6F0]">
            {JSON.stringify(args, null, 2)}
          </pre>
        )}
      </div>

      {/* Supporting Evidence References */}
      {action.supportingEvidenceRefs && action.supportingEvidenceRefs.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] text-[#6B6255] uppercase tracking-wider">
            Correlated Evidence References:
          </span>
          <div className="flex flex-wrap gap-1.5">
            {action.supportingEvidenceRefs.map((ref) => (
              <span key={ref} className="badge badge-synthetic font-mono text-[10px]">
                🔗 {ref}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Reversibility & Expected Impact (ONLY if explicitly supplied by backend) */}
      {(action.expectedImpact || action.reversibility) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-[#DFD7C7]">
          {action.expectedImpact && (
            <div className="bg-[#FAF6F0] p-2 border border-[#DFD7C7]">
              <span className="text-[10px] text-[#6B6255] uppercase block">Expected Impact:</span>
              <span className="text-xs text-[#1C1917] font-sans">{action.expectedImpact}</span>
            </div>
          )}
          {action.reversibility && (
            <div className="bg-[#FAF6F0] p-2 border border-[#DFD7C7]">
              <span className="text-[10px] text-[#6B6255] uppercase block">Reversibility:</span>
              <span className="text-xs text-[#1C1917] font-sans">{action.reversibility}</span>
            </div>
          )}
        </div>
      )}

      {/* Execution Results / Error Details (if execution took place) */}
      {(hasExecResult || action.executionError) && (
        <div className="bg-[#ECE6DC] p-3 border border-[#DFD7C7] flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <span className="text-[10px] text-[#6B6255] uppercase tracking-wider">
              Execution Observation Result
            </span>
            <button
              type="button"
              onClick={() => setShowRawExecution(!showRawExecution)}
              className="text-[10px] text-[#0E7490] hover:underline flex items-center gap-0.5"
            >
              {showRawExecution ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <span>{showRawExecution ? 'Hide Payload' : 'View Payload'}</span>
            </button>
          </div>

          {action.executionError && (
            <div className="p-2 bg-red-100 border border-red-300 text-red-900 text-xs">
              <strong>Error:</strong> {action.executionError}
            </div>
          )}

          {showRawExecution && hasExecResult && (
            <pre className="payload-json text-[11px] p-2 bg-[#FAF6F0]">
              {JSON.stringify(execResult, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* Footer Timestamp & Actor */}
      {(action.timestamp || action.actor) && (
        <div className="flex justify-between items-center text-[10px] text-[#827869] pt-2 border-t border-[#DFD7C7]">
          {action.actor && (
            <span className="flex items-center gap-1">
              <User className="w-3 h-3" /> Actor: <strong>{action.actor}</strong>
            </span>
          )}
          {action.timestamp && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" /> Recorded: {new Date(action.timestamp).toLocaleString()}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
