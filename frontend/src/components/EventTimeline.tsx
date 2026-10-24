import React, { useState } from 'react';
import { Terminal, ChevronRight, ChevronDown } from 'lucide-react';
import { Event } from '../types';

interface EventTimelineProps {
  events: Event[];
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'completed';
  incidentId: string | null;
}

const ACTOR_BADGE_CLASSES: Record<string, string> = {
  agent: 'badge-violet',
  gate: 'badge-cyan',
  tool: 'badge-synthetic',
  verifier: 'badge-emerald',
  human: 'badge-amber',
  system: 'badge-synthetic',
};

export const EventTimeline: React.FC<EventTimelineProps> = ({
  events,
  connectionStatus,
  incidentId,
}) => {
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const getEventSummary = (event: Event): string => {
    const p = event.payload || {};
    switch (event.type) {
      case 'incident_opened':
        return `Incident opened for scenario "${p.scenario}" and client "${p.client}". Mode: ${p.requested_mode || 'proofloop'}`;
      case 'investigation_started':
        return `Investigation initiated (step limit: ${p.step_limit || 8}, action limit: ${p.action_limit || 3}). Authorized scope: [${(p.incident_scope || ['checkout-service']).join(', ')}]`;
      case 'evidence_collected':
        return `Evidence collected from ${p.source || 'checkout-service'}: ${Array.isArray(p.excerpt) ? p.excerpt.length : 0} log entries parsed.`;
      case 'evidence_observed':
        return `Observed evidence [${p.id || 'EVD'}] (${p.source || 'telemetry'}): ${p.description || p.kind || ''}`;
      case 'evidence_correlated':
        return `Correlated [${p.evidence_id || 'EVD'}]: supports [${(p.supporting_hypotheses || []).join(', ') || 'none'}], contradicts [${(p.contradicting_hypotheses || []).join(', ') || 'none'}]`;
      case 'hypothesis_created':
        return `Formulated hypothesis [${p.id || 'HYP'}]: ${p.description || p.category} (likelihood: ${((p.likelihood_score || 0) * 100).toFixed(0)}%)`;
      case 'hypothesis_updated':
        return `Updated competing hypotheses ranking (${(p.hypotheses || []).length} active)`;
      case 'diagnostic_selected':
        return `Selected diagnostic: ${p.tool} targeting ${p.target_hypothesis_id || 'competing hypotheses'} (EIV score: ${typeof p.eiv_score === 'number' ? p.eiv_score.toFixed(3) : p.eiv_score ?? 'N/A'})`;
      case 'diagnostic_started':
        return `Running diagnostic probe: ${p.tool}`;
      case 'diagnostic_completed':
        return `Diagnostic probe completed: ${p.tool} (${p.success ? 'SUCCESS' : 'FAILED'}, ${p.duration_ms ?? 0}ms)`;
      case 'diagnosis_updated':
        return `Diagnosis updated: ${p.primary_hypothesis_id || 'None'} [${p.status || 'tentative'}] - ${p.rationale || ''}`;
      case 'diagnosis_sufficient':
        return `Diagnosis reached sufficiency threshold for ${p.hypothesis_id} (confidence: ${((p.confidence || 0) * 100).toFixed(0)}%)`;
      case 'diagnosis_uncertain':
        return `Diagnosis remains uncertain: ${p.reason || 'Unresolved hypothesis conflicts'}`;
      case 'injection_detected':
        return `🚨 Instruction-like content found in untrusted logs. Treated strictly as data; authorization unchanged.`;
      case 'remediation_proposed':
        return `Remediation proposed: ${p.tool} (hypothesis: ${p.hypothesis_id || 'primary'}, confidence: ${((p.confidence || 0) * 100).toFixed(0)}%)`;
      case 'action_proposed':
        return `Investigator proposed: ${p.tool} (${p.service || 'checkout-service'}). Rationale: ${p.rationale || 'N/A'}`;
      case 'policy_decision':
        return `Policy gate decided: ${p.decision} [${p.rule_id || 'RULE'}]. ${p.reason || ''}`;
      case 'approval_requested':
        return `Action paused for human authorization: ${p.tool}. Rule: ${p.rule_id}.`;
      case 'human_approval_decision':
        return `Human decision recorded: ${p.decision?.toUpperCase()} by ${p.approver_id}. Comment: "${p.comment || ''}"`;
      case 'approval_rejected_by_policy':
        return `Action rejected by policy re-evaluation at approval time: ${p.reason}`;
      case 'tool_executed':
        return `Synthetic execution: ${p.tool} -> ${p.success ? 'SUCCESS' : 'FAILED'} (${p.message || ''})`;
      case 'remediation_evaluation_started':
        return `Evaluating actual recovery for remediation: ${p.tool} (attempt ${p.attempt}, replanning cycle ${p.replanning_cycle ?? 0})`;
      case 'verification_check':
        return `Independent check: ${p.check_name} -> ${p.passed ? 'PASSED' : 'FAILED'}`;
      case 'verification_result':
        return `Independent verification summary: ${p.all_passed ? 'ALL CHECKS PASSED' : 'CHECKS FAILED'}`;
      case 'independent_verification_failed':
        return `Independent verification failed after ${p.tool}: [${(p.failed_checks || []).join(', ')}]`;
      case 'recovery_invariant_failed':
        return `Mandatory recovery invariant failed: ${p.invariant} after ${p.tool}`;
      case 'post_action_evidence_observed':
        return `Post-remediation observation [${p.id || 'EVD'}] (${p.source || 'telemetry'}): ${p.description || p.kind || ''}`;
      case 'hypothesis_revised_after_remediation':
        return `Hypothesis ranking revised post-remediation for replanning cycle ${p.replanning_cycle ?? 1}`;
      case 'replanning_started':
        return `Adaptive replanning started (cycle ${p.cycle ?? 1}): ${p.reason}. Remaining action budget: ${p.remaining_remediation_budget ?? 0}`;
      case 'recovery_plan_changed':
        return `Recovery plan adapted: ${p.reason || `from ${p.old_plan || 'initial'} to ${p.new_plan || 'revised'}`}`;
      case 'new_remediation_proposed':
        return `Adaptive remediation proposed: ${p.tool} for cycle ${p.cycle ?? 1}. Rationale: ${p.rationale || 'Address residual invariants'}`;
      case 'retry_budget_exhausted':
        return `Remediation retry budget exhausted (${p.attempts}/${p.limit} attempts). Halting further actions.`;
      case 'investigation_limit_reached':
      case 'investigation_budget_exhausted':
        return `Investigation budget exhausted (${p.steps || p.limit || 8}/${p.limit || 8} steps). Halting automated actions.`;
      case 'escalation_reason_recorded':
        return `Escalation reason recorded: ${p.reason}`;
      case 'investigation_escalated':
        return `Investigation escalated safely: ${p.reason}`;
      case 'outcome':
        return `Terminal incident outcome: ${p.outcome}. ${p.summary || ''}`;
      case 'worker_error':
        return `Background worker error: ${p.error_type || 'Unknown'}`;
      default:
        return typeof p === 'object' && p !== null ? (p.message || p.summary || p.reason || JSON.stringify(p)) : String(p);
    }
  };

  return (
    <div className="panel flex-1" data-testid="event-timeline">
      <div className="panel-header">
        <h2 className="panel-title">
          <Terminal className="w-4 h-4 text-[#0E7490]" />
          <span>Evidence & Audit Event Stream</span>
          {incidentId && (
            <span className="font-mono text-xs text-[#827869] font-normal ml-1">
              ({incidentId.slice(0, 8)}...)
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          <span className="badge badge-synthetic font-mono text-[11px]">
            {events.length} {events.length === 1 ? 'EVENT' : 'EVENTS'}
          </span>
          <span
            className={`badge font-mono text-[11px] ${
              connectionStatus === 'connected'
                ? 'badge-emerald'
                : connectionStatus === 'completed'
                ? 'badge-cyan'
                : connectionStatus === 'connecting'
                ? 'badge-amber'
                : 'badge-rose'
            }`}
          >
            {connectionStatus.toUpperCase()}
          </span>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="p-12 text-center text-[#827869] flex flex-col items-center gap-2">
          <Terminal className="w-8 h-8 text-[#DFD7C7] mb-1" />
          <div className="font-mono text-xs font-bold uppercase tracking-wider text-[#1C1917]">
            NO AUDIT EVENTS RECORDED
          </div>
          <div className="text-xs text-[#827869] max-w-sm leading-relaxed">
            Launch a scenario or select a past incident from the Incidents log to inspect the live audit trail and policy evaluations.
          </div>
        </div>
      ) : (
        <div className="timeline-container">
          {events.map((event, idx) => {
            const isExpanded = expandedEvents.has(event.event_id || `idx-${idx}`);
            const actorClass = ACTOR_BADGE_CLASSES[event.actor] || 'badge-synthetic';

            return (
              <div key={event.event_id || `evt-${idx}`} className="timeline-item">
                <div className="timeline-item-header">
                  <div className="timeline-meta">
                    <span className="timeline-sequence font-mono">
                      #{event.sequence !== undefined ? event.sequence : idx + 1}
                    </span>
                    <span className={`badge font-mono text-[10px] ${actorClass}`}>{event.actor}</span>
                    <span className="badge badge-synthetic font-mono text-[10px]">
                      {event.type}
                    </span>
                  </div>
                  <span className="timeline-timestamp font-mono">
                    {event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : ''}
                  </span>
                </div>

                <div className="timeline-summary font-sans text-xs">{getEventSummary(event)}</div>

                {event.evidence_refs && event.evidence_refs.length > 0 && (
                  <div className="flex gap-1.5 mb-2 flex-wrap">
                    {event.evidence_refs.map((ref) => (
                      <span key={ref} className="badge badge-synthetic font-mono text-[10px]">
                        🔗 {ref}
                      </span>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  className="payload-toggle font-mono text-[11px] flex items-center gap-1"
                  onClick={() => toggleExpand(event.event_id || `idx-${idx}`)}
                >
                  {isExpanded ? (
                    <>
                      <ChevronDown className="w-3.5 h-3.5" />
                      <span>Hide Payload</span>
                    </>
                  ) : (
                    <>
                      <ChevronRight className="w-3.5 h-3.5" />
                      <span>View Structured Payload</span>
                    </>
                  )}
                </button>

                {isExpanded && (
                  <pre className="payload-json">
                    {JSON.stringify(event.payload, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
