import React, { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Terminal,
  ChevronDown,
  ChevronRight,
  Layers,
} from 'lucide-react';
import { Event, IncidentResponse, LifecycleStage } from '../types';

interface ActionLifecycleTimelineProps {
  events: Event[];
  activeIncident?: IncidentResponse | null;
  className?: string;
}

interface ActionAttemptLifecycle {
  attemptId: string;
  attemptNumber: number;
  tool: string;
  service: string;
  arguments?: Record<string, any>;
  evidenceRefs: string[];
  stages: LifecycleStage[];
  isComplete: boolean;
  terminalOutcome?: string;
}

export const ActionLifecycleTimeline: React.FC<ActionLifecycleTimelineProps> = ({
  events,
  activeIncident,
  className = '',
}) => {
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);
  const [expandedStageKey, setExpandedStageKey] = useState<string | null>(null);

  // Group events into action attempt lifecycles
  const lifecycles: ActionAttemptLifecycle[] = React.useMemo(() => {
    const attempts: ActionAttemptLifecycle[] = [];
    let currentAttempt: ActionAttemptLifecycle | null = null;
    let attemptCounter = 0;

    events.forEach((ev) => {
      const p = ev.payload || {};

      if (ev.type === 'action_proposed' || ev.type === 'remediation_proposed') {
        attemptCounter += 1;
        currentAttempt = {
          attemptId: ev.event_id || `attempt-${attemptCounter}`,
          attemptNumber: p.attempt || attemptCounter,
          tool: p.tool || 'Unknown Tool',
          service: p.service || 'checkout-service',
          arguments: p.arguments || {},
          evidenceRefs: ev.evidence_refs || [],
          stages: [],
          isComplete: false,
        };

        currentAttempt.stages.push({
          key: 'proposal',
          label: '1. Action Proposed',
          status: 'passed',
          timestamp: ev.timestamp,
          actor: ev.actor,
          summary: `Investigator proposed ${p.tool}. Rationale: "${p.rationale || 'N/A'}"`,
          details: { arguments: p.arguments, rationale: p.rationale, mode: p.mode },
          evidenceRefs: ev.evidence_refs,
        });

        attempts.push(currentAttempt);
      } else if (ev.type === 'policy_decision') {
        if (!currentAttempt) {
          attemptCounter += 1;
          currentAttempt = {
            attemptId: ev.event_id || `attempt-${attemptCounter}`,
            attemptNumber: attemptCounter,
            tool: p.tool || 'Evaluated Action',
            service: 'checkout-service',
            evidenceRefs: ev.evidence_refs || [],
            stages: [],
            isComplete: false,
          };
          attempts.push(currentAttempt);
        }

        const decision = p.decision;
        const status =
          decision === 'ALLOWED'
            ? 'passed'
            : decision === 'APPROVAL_REQUIRED'
            ? 'pending'
            : 'blocked';

        currentAttempt.stages.push({
          key: 'policy',
          label: '2. Policy Gate Evaluation',
          status: status,
          timestamp: ev.timestamp,
          actor: ev.actor,
          summary: `Gate Decision: ${decision} [Rule: ${p.rule_id || 'DEFAULT'}]. ${p.reason || ''}`,
          details: { decision, rule_id: p.rule_id, reason: p.reason },
          evidenceRefs: ev.evidence_refs,
        });
      } else if (ev.type === 'approval_requested') {
        if (currentAttempt) {
          currentAttempt.stages.push({
            key: 'approval',
            label: '3. Human Authorization',
            status: 'pending',
            timestamp: ev.timestamp,
            actor: ev.actor,
            summary: `Execution paused at safety boundary. Tool "${p.tool}" awaiting human decision under rule ${p.rule_id}.`,
            details: p,
            evidenceRefs: ev.evidence_refs,
          });
        }
      } else if (ev.type === 'human_approval_decision') {
        if (currentAttempt) {
          const isApproved = p.decision === 'approve';
          // Find existing approval stage or append
          const existingApproval = currentAttempt.stages.find((s) => s.key === 'approval');
          if (existingApproval) {
            existingApproval.status = isApproved ? 'passed' : 'rejected';
            existingApproval.summary = `Human Decision: ${p.decision?.toUpperCase()} by ${p.approver_id}. Comment: "${p.comment || ''}"`;
            existingApproval.timestamp = ev.timestamp;
            existingApproval.actor = ev.actor;
            existingApproval.details = p;
          } else {
            currentAttempt.stages.push({
              key: 'approval',
              label: '3. Human Authorization',
              status: isApproved ? 'passed' : 'rejected',
              timestamp: ev.timestamp,
              actor: ev.actor,
              summary: `Human Decision: ${p.decision?.toUpperCase()} by ${p.approver_id}. Comment: "${p.comment || ''}"`,
              details: p,
            });
          }
        }
      } else if (ev.type === 'approval_rejected_by_policy') {
        if (currentAttempt) {
          currentAttempt.stages.push({
            key: 'approval',
            label: '3. Policy Revalidation',
            status: 'failed',
            timestamp: ev.timestamp,
            actor: ev.actor,
            summary: `Action rejected upon policy revalidation: ${p.reason || 'Safety criteria not met at execution time.'}`,
            details: p,
          });
        }
      } else if (ev.type === 'tool_executed') {
        if (currentAttempt) {
          currentAttempt.stages.push({
            key: 'execution',
            label: '4. Synthetic Execution',
            status: p.success ? 'passed' : 'failed',
            timestamp: ev.timestamp,
            actor: ev.actor,
            summary: `Simulator execution: ${p.tool} -> ${p.success ? 'SUCCESS' : 'FAILED'}. (${p.message || ''})`,
            details: p,
          });
        }
      } else if (ev.type === 'verification_result') {
        if (currentAttempt) {
          currentAttempt.stages.push({
            key: 'verification',
            label: '5. Independent Recovery Verification',
            status: p.all_passed ? 'passed' : 'failed',
            timestamp: ev.timestamp,
            actor: ev.actor,
            summary: p.all_passed
              ? 'All 3 independent verification checks passed.'
              : 'Verification failed: one or more invariant checks failed.',
            details: p,
          });
        }
      } else if (ev.type === 'outcome') {
        if (currentAttempt) {
          currentAttempt.isComplete = true;
          currentAttempt.terminalOutcome = p.outcome;
          currentAttempt.stages.push({
            key: 'outcome',
            label: '6. Terminal Incident Outcome',
            status:
              p.outcome === 'VERIFIED'
                ? 'passed'
                : p.outcome === 'BLOCKED'
                ? 'blocked'
                : 'failed',
            timestamp: ev.timestamp,
            actor: ev.actor,
            summary: `Outcome: ${p.outcome}. ${p.summary || ''}`,
            details: p,
          });
        }
      }
    });

    return attempts;
  }, [events]);

  const activeAttempt =
    lifecycles.find((a) => a.attemptId === selectedAttemptId) ||
    lifecycles[lifecycles.length - 1];

  if (lifecycles.length === 0) {
    return (
      <div className={`panel p-8 text-center text-[#827869] font-mono text-xs ${className}`}>
        <Terminal className="w-8 h-8 text-[#DFD7C7] mx-auto mb-2" />
        <div className="font-bold uppercase tracking-wider text-[#1C1917]">
          NO ACTION LIFECYCLE EVENTS RECORDED
        </div>
        <p className="mt-1 text-[#827869] max-w-sm mx-auto">
          Start a run in Live Operations to view the end-to-end evidence chain: Proposal &rarr; Policy Gate &rarr; Approval &rarr; Execution &rarr; Verification.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`panel border border-[#DFD7C7] bg-[#FAF6F0] p-4 flex flex-col gap-4 text-xs font-mono ${className}`}
      data-testid="action-lifecycle-timeline"
    >
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#DFD7C7] pb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-[#1C1917] text-[#FAF6F0] flex items-center justify-center font-mono">
            <Layers className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-[#1C1917] uppercase tracking-wider">
              ACTION GOVERNANCE LIFECYCLE
            </h3>
            <span className="text-[10px] text-[#6B6255] font-sans">
              Strict audit trail connecting proposals to independent verifier outcomes.
              {activeIncident && (
                <span className="badge badge-synthetic font-mono text-[10px] ml-1">
                  {activeIncident.incident_id.slice(0, 8)}&hellip;
                </span>
              )}
            </span>
          </div>
        </div>

        {/* Multi-attempt tab bar if multiple attempts occurred */}
        {lifecycles.length > 1 && (
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[10px] text-[#827869] uppercase mr-1">Attempt:</span>
            {lifecycles.map((att) => (
              <button
                key={att.attemptId}
                type="button"
                onClick={() => setSelectedAttemptId(att.attemptId)}
                className={`px-2 py-1 text-[10px] font-mono font-bold uppercase transition-colors ${
                  activeAttempt?.attemptId === att.attemptId
                    ? 'bg-[#1C1917] text-[#FAF6F0]'
                    : 'bg-[#ECE6DC] text-[#6B6255] hover:text-[#1C1917]'
                }`}
              >
                #{att.attemptNumber}: {att.tool}
              </button>
            ))}
          </div>
        )}
      </div>

      {activeAttempt && (
        <div className="flex flex-col gap-4">
          {/* Action Identity Strip */}
          <div className="flex items-center justify-between gap-2 bg-[#ECE6DC] p-2.5 border border-[#DFD7C7] flex-wrap">
            <div className="flex items-center gap-2">
              <span className="font-bold text-[#1C1917] uppercase">
                Tool: <span className="text-[#0E7490]">{activeAttempt.tool}</span>
              </span>
              <span className="badge badge-synthetic font-mono text-[10px]">
                Target: {activeAttempt.service}
              </span>
            </div>
            {activeAttempt.terminalOutcome && (
              <span
                className={`badge font-mono text-[10px] ${
                  activeAttempt.terminalOutcome === 'VERIFIED'
                    ? 'badge-emerald'
                    : activeAttempt.terminalOutcome === 'BLOCKED'
                    ? 'badge-rose'
                    : 'badge-amber'
                }`}
              >
                Terminal: {activeAttempt.terminalOutcome}
              </span>
            )}
          </div>

          {/* Sequential Lifecycle Stages */}
          <div className="flex flex-col gap-2.5">
            {activeAttempt.stages.map((stage) => {
              const isExpanded = expandedStageKey === `${activeAttempt.attemptId}-${stage.key}`;
              const isPassed = stage.status === 'passed';
              const isFailed = stage.status === 'failed';
              const isBlocked = stage.status === 'blocked';
              const isRejected = stage.status === 'rejected';
              const isPending = stage.status === 'pending';

              return (
                <div
                  key={stage.key}
                  className={`p-3 border transition-colors ${
                    isPassed
                      ? 'border-emerald-300 bg-emerald-50/30'
                      : isFailed || isRejected || isBlocked
                      ? 'border-rose-300 bg-rose-50/30'
                      : isPending
                      ? 'border-amber-300 bg-amber-50/40'
                      : 'border-[#DFD7C7] bg-[#ECE6DC]'
                  }`}
                  data-testid={`lifecycle-stage-${stage.key}`}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                    <div className="flex items-center gap-2">
                      {isPassed && <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />}
                      {(isFailed || isRejected || isBlocked) && (
                        <XCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                      )}
                      {isPending && <Clock className="w-4 h-4 text-amber-600 flex-shrink-0" />}

                      <span className="font-bold text-xs uppercase text-[#1C1917]">
                        {stage.label}
                      </span>

                      <span
                        className={`badge font-mono text-[9px] ${
                          isPassed
                            ? 'badge-emerald'
                            : isFailed || isRejected || isBlocked
                            ? 'badge-rose'
                            : isPending
                            ? 'badge-amber'
                            : 'badge-synthetic'
                        }`}
                      >
                        {stage.status.toUpperCase()}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[10px] text-[#827869]">
                      {stage.actor && <span>Actor: <strong>{stage.actor}</strong></span>}
                      {stage.timestamp && (
                        <span>{new Date(stage.timestamp).toLocaleTimeString()}</span>
                      )}
                    </div>
                  </div>

                  {/* Stage Summary */}
                  <div className="text-xs text-[#575044] font-sans mt-0.5 leading-relaxed">
                    {stage.summary}
                  </div>

                  {/* Evidence References */}
                  {stage.evidenceRefs && stage.evidenceRefs.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {stage.evidenceRefs.map((ref) => (
                        <span key={ref} className="badge badge-synthetic font-mono text-[9px]">
                          🔗 {ref}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Expandable Technical Details */}
                  {stage.details && Object.keys(stage.details).length > 0 && (
                    <div className="mt-2 pt-1 border-t border-[#DFD7C7]/60">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedStageKey(
                            isExpanded ? null : `${activeAttempt.attemptId}-${stage.key}`
                          )
                        }
                        className="text-[10px] text-[#0E7490] hover:underline flex items-center gap-0.5"
                      >
                        {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        <span>{isExpanded ? 'Hide Stage Payload' : 'View Stage Payload'}</span>
                      </button>

                      {isExpanded && (
                        <pre className="payload-json text-[10px] mt-1.5 p-2 bg-[#FAF6F0]">
                          {JSON.stringify(stage.details, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
