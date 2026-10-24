import React, { useState, useMemo } from 'react';
import {
  Shield,
  ChevronDown,
  ChevronRight,
  Filter,
} from 'lucide-react';
import { Event, IncidentResponse, PolicyDecision } from '../types';

interface PolicyDecisionExplorerProps {
  events: Event[];
  activeIncident?: IncidentResponse | null;
  className?: string;
}

export interface ExtractedPolicyEvent {
  eventId: string;
  sequence?: number;
  timestamp: string;
  decision: PolicyDecision | 'REVALIDATION_FAILED';
  ruleId: string;
  reason: string;
  tool: string;
  service: string;
  arguments?: Record<string, any>;
  evidenceRefs: string[];
  subsequentApproval?: {
    status: 'approved' | 'denied' | 'pending';
    approverId?: string;
    comment?: string;
  };
  subsequentExecution?: {
    success: boolean;
    message?: string;
    error?: string | null;
  };
  subsequentVerification?: {
    allPassed: boolean;
  };
}

export const PolicyDecisionExplorer: React.FC<PolicyDecisionExplorerProps> = ({
  events,
  activeIncident,
  className = '',
}) => {
  const [filter, setFilter] = useState<string>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Extract real policy decision events and correlate with subsequent execution/verification
  const policyRecords: ExtractedPolicyEvent[] = useMemo(() => {
    const records: ExtractedPolicyEvent[] = [];

    events.forEach((ev, idx) => {
      if (ev.type === 'policy_decision') {
        const p = ev.payload || {};

        // Find associated action proposal
        const priorProposal = events
          .slice(0, idx)
          .reverse()
          .find((e) => e.type === 'action_proposed' || e.type === 'remediation_proposed');

        const tool = p.tool || priorProposal?.payload?.tool || 'Unknown Tool';
        const service = p.service || priorProposal?.payload?.service || 'checkout-service';
        const args = p.arguments || priorProposal?.payload?.arguments || {};

        // Look forward for subsequent approval, execution, and verification
        const futureEvents = events.slice(idx + 1);

        const approvalEv = futureEvents.find((e) => e.type === 'human_approval_decision');
        const execEv = futureEvents.find((e) => e.type === 'tool_executed');
        const verifEv = futureEvents.find((e) => e.type === 'verification_result');

        let approvalInfo: ExtractedPolicyEvent['subsequentApproval'] = undefined;
        if (p.decision === 'APPROVAL_REQUIRED') {
          if (approvalEv) {
            approvalInfo = {
              status: approvalEv.payload?.decision === 'approve' ? 'approved' : 'denied',
              approverId: approvalEv.payload?.approver_id,
              comment: approvalEv.payload?.comment,
            };
          } else {
            approvalInfo = { status: 'pending' };
          }
        }

        let execInfo: ExtractedPolicyEvent['subsequentExecution'] = undefined;
        if (execEv) {
          execInfo = {
            success: Boolean(execEv.payload?.success),
            message: execEv.payload?.message,
            error: execEv.payload?.error,
          };
        }

        let verifInfo: ExtractedPolicyEvent['subsequentVerification'] = undefined;
        if (verifEv) {
          verifInfo = {
            allPassed: Boolean(verifEv.payload?.all_passed),
          };
        }

        records.push({
          eventId: ev.event_id || `policy-${idx}`,
          sequence: ev.sequence,
          timestamp: ev.timestamp,
          decision: p.decision,
          ruleId: p.rule_id || 'DEFAULT_GATE',
          reason: p.reason || 'Operation evaluated by governance engine.',
          tool,
          service,
          arguments: args,
          evidenceRefs: ev.evidence_refs || [],
          subsequentApproval: approvalInfo,
          subsequentExecution: execInfo,
          subsequentVerification: verifInfo,
        });
      } else if (ev.type === 'approval_rejected_by_policy') {
        const p = ev.payload || {};
        records.push({
          eventId: ev.event_id || `reject-${idx}`,
          sequence: ev.sequence,
          timestamp: ev.timestamp,
          decision: 'REVALIDATION_FAILED',
          ruleId: p.rule_id || 'REVALIDATION_GATE',
          reason: p.reason || 'Action failed policy re-evaluation at execution time.',
          tool: p.tool || 'remediation_tool',
          service: p.service || 'checkout-service',
          arguments: p.arguments || {},
          evidenceRefs: ev.evidence_refs || [],
        });
      }
    });

    return records;
  }, [events]);

  const filteredRecords = policyRecords.filter((rec) => {
    if (filter === 'ALL') return true;
    if (filter === 'EXECUTION_FAILED') {
      return rec.subsequentExecution && !rec.subsequentExecution.success;
    }
    return rec.decision === filter;
  });

  return (
    <div
      className={`panel border border-[#DFD7C7] bg-[#FAF6F0] p-4 flex flex-col gap-4 text-xs font-mono ${className}`}
      data-testid="policy-decision-explorer"
    >
      {/* Explorer Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#DFD7C7] pb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-[#1C1917] text-[#FAF6F0] flex items-center justify-center font-mono">
            <Shield className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-[#1C1917] uppercase tracking-wider">
              POLICY DECISION EXPLORER
            </h3>
            <span className="text-[10px] text-[#6B6255] font-sans">
              Deterministic gate evaluations authoritative on backend server.
              {activeIncident && (
                <span className="badge badge-synthetic font-mono text-[10px] ml-1">
                  {activeIncident.incident_id.slice(0, 8)}&hellip;
                </span>
              )}
            </span>
          </div>
        </div>

        {/* Filter buttons */}
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] text-[#827869] uppercase mr-1 flex items-center gap-0.5">
            <Filter className="w-3 h-3" /> Filter:
          </span>
          {['ALL', 'ALLOWED', 'APPROVAL_REQUIRED', 'BLOCKED', 'REVALIDATION_FAILED', 'EXECUTION_FAILED'].map(
            (opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setFilter(opt)}
                className={`px-2 py-1 text-[9px] font-mono font-bold uppercase transition-colors ${
                  filter === opt
                    ? 'bg-[#1C1917] text-[#FAF6F0]'
                    : 'bg-[#ECE6DC] text-[#6B6255] hover:text-[#1C1917]'
                }`}
              >
                {opt.replace('_', ' ')}
              </button>
            )
          )}
        </div>
      </div>

      {/* Safety Boundary Notice */}
      <div className="p-3 bg-[#ECE6DC] border border-[#DFD7C7] text-xs font-mono text-[#575044] leading-relaxed">
        <strong className="text-[#1C1917]">GOVERNANCE PRINCIPLE:</strong> Policy authorization allows an action to be scheduled in the synthetic simulator. It does <em>not</em> guarantee execution success, nor does successful execution imply verified service recovery.
      </div>

      {/* Empty State */}
      {filteredRecords.length === 0 ? (
        <div className="p-8 text-center text-[#827869] font-mono text-xs">
          No policy decisions match the selected filter.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredRecords.map((rec) => {
            const isExpanded = expandedId === rec.eventId;
            const isAllowed = rec.decision === 'ALLOWED';
            const isApprovalReq = rec.decision === 'APPROVAL_REQUIRED';
            const isBlocked = rec.decision === 'BLOCKED' || rec.decision === 'REVALIDATION_FAILED';

            return (
              <div
                key={rec.eventId}
                className={`p-3.5 border transition-all ${
                  isAllowed
                    ? 'border-emerald-300 bg-emerald-50/20'
                    : isApprovalReq
                    ? 'border-amber-300 bg-amber-50/30'
                    : 'border-rose-300 bg-rose-50/30'
                }`}
                data-testid={`policy-record-${rec.eventId}`}
              >
                {/* Decision Header */}
                <div className="flex items-center justify-between gap-2 flex-wrap mb-2 border-b border-[#DFD7C7] pb-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`badge font-mono text-[10px] ${
                        isAllowed
                          ? 'badge-emerald'
                          : isApprovalReq
                          ? 'badge-amber'
                          : 'badge-rose'
                      }`}
                    >
                      {rec.decision}
                    </span>

                    <span className="font-bold text-xs text-[#1C1917]">
                      Rule: {rec.ruleId}
                    </span>

                    <span className="badge badge-synthetic font-mono text-[10px]">
                      Tool: {rec.tool}
                    </span>
                  </div>

                  <span className="text-[10px] font-mono text-[#827869]">
                    {rec.timestamp ? new Date(rec.timestamp).toLocaleTimeString() : ''}
                  </span>
                </div>

                {/* Reason description */}
                <div className="text-xs text-[#1C1917] font-sans leading-relaxed mb-2">
                  <strong>Policy Gate Evaluation:</strong> "{rec.reason}"
                </div>

                {/* Correlated Downstream Stages */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 my-2 text-[11px] font-mono">
                  {/* Approval outcome */}
                  <div className="bg-[#FAF6F0] p-2 border border-[#DFD7C7]">
                    <span className="text-[10px] text-[#827869] uppercase block mb-0.5">
                      Approval Stage:
                    </span>
                    {rec.subsequentApproval ? (
                      <span
                        className={`badge font-mono text-[9px] ${
                          rec.subsequentApproval.status === 'approved'
                            ? 'badge-emerald'
                            : rec.subsequentApproval.status === 'denied'
                            ? 'badge-rose'
                            : 'badge-amber'
                        }`}
                      >
                        {rec.subsequentApproval.status.toUpperCase()}
                      </span>
                    ) : (
                      <span className="text-[#827869] italic">NOT REQUIRED</span>
                    )}
                  </div>

                  {/* Execution outcome */}
                  <div className="bg-[#FAF6F0] p-2 border border-[#DFD7C7]">
                    <span className="text-[10px] text-[#827869] uppercase block mb-0.5">
                      Execution Stage:
                    </span>
                    {rec.subsequentExecution ? (
                      <span
                        className={`badge font-mono text-[9px] ${
                          rec.subsequentExecution.success ? 'badge-emerald' : 'badge-rose'
                        }`}
                      >
                        {rec.subsequentExecution.success ? 'EXECUTED (SUCCESS)' : 'FAILED'}
                      </span>
                    ) : (
                      <span className="text-[#827869] italic">
                        {isBlocked ? 'BLOCKED BEFORE EXECUTION' : 'PENDING'}
                      </span>
                    )}
                  </div>

                  {/* Verification outcome */}
                  <div className="bg-[#FAF6F0] p-2 border border-[#DFD7C7]">
                    <span className="text-[10px] text-[#827869] uppercase block mb-0.5">
                      Verification Stage:
                    </span>
                    {rec.subsequentVerification ? (
                      <span
                        className={`badge font-mono text-[9px] ${
                          rec.subsequentVerification.allPassed ? 'badge-emerald' : 'badge-rose'
                        }`}
                      >
                        {rec.subsequentVerification.allPassed ? 'VERIFIED (3/3 PASSED)' : 'INDEPENDENT CHECK FAILED'}
                      </span>
                    ) : (
                      <span className="text-[#827869] italic">AWAITING VERIFIER</span>
                    )}
                  </div>
                </div>

                {/* Evidence references */}
                {rec.evidenceRefs && rec.evidenceRefs.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap mt-2">
                    <span className="text-[10px] text-[#827869]">Evidence:</span>
                    {rec.evidenceRefs.map((ref) => (
                      <span key={ref} className="badge badge-synthetic font-mono text-[9px]">
                        🔗 {ref}
                      </span>
                    ))}
                  </div>
                )}

                {/* Expandable tool arguments */}
                {rec.arguments && Object.keys(rec.arguments).length > 0 && (
                  <div className="mt-2 pt-1 border-t border-[#DFD7C7]">
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : rec.eventId)}
                      className="text-[10px] text-[#0E7490] hover:underline flex items-center gap-0.5"
                    >
                      {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      <span>{isExpanded ? 'Hide Evaluated Arguments' : 'View Evaluated Arguments'}</span>
                    </button>
                    {isExpanded && (
                      <pre className="payload-json text-[10px] mt-1 p-2 bg-[#FAF6F0]">
                        {JSON.stringify(rec.arguments, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
