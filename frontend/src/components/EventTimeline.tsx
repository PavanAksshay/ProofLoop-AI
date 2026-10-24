import React, { useState, useMemo } from 'react';
import {
  Terminal,
  ChevronRight,
  ChevronDown,
  Search,
  Lock,
} from 'lucide-react';
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

const KNOWN_EVENT_TYPES = new Set([
  'incident_opened',
  'evidence_collected',
  'evidence_observed',
  'evidence_correlated',
  'post_action_evidence_observed',
  'injection_detected',
  'investigation_started',
  'hypothesis_created',
  'hypothesis_updated',
  'diagnosis_updated',
  'diagnosis_sufficient',
  'diagnosis_uncertain',
  'action_proposed',
  'remediation_proposed',
  'new_remediation_proposed',
  'diagnostic_selected',
  'diagnostic_started',
  'diagnostic_completed',
  'policy_decision',
  'approval_requested',
  'human_approval_decision',
  'approval_rejected_by_policy',
  'tool_executed',
  'remediation_evaluation_started',
  'verification_check',
  'verification_result',
  'independent_verification_failed',
  'recovery_invariant_failed',
  'replanning_started',
  'recovery_plan_changed',
  'hypothesis_revised_after_remediation',
  'investigation_limit_reached',
  'investigation_budget_exhausted',
  'retry_budget_exhausted',
  'escalation_reason_recorded',
  'investigation_escalated',
  'outcome',
  'worker_error',
]);

export const EventTimeline: React.FC<EventTimelineProps> = ({
  events,
  connectionStatus,
  incidentId,
}) => {
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [policyFilter, setPolicyFilter] = useState<string>('ALL');
  const [executionFilter, setExecutionFilter] = useState<string>('ALL');
  const [verificationFilter, setVerificationFilter] = useState<string>('ALL');

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

  const getEventCategory = (type: string): string => {
    if (
      type.startsWith('hypothesis_') ||
      type === 'investigation_started' ||
      type === 'diagnosis_updated' ||
      type === 'diagnosis_sufficient' ||
      type === 'diagnosis_uncertain' ||
      type.startsWith('diagnostic_') ||
      type === 'replanning_started' ||
      type === 'recovery_plan_changed'
    ) {
      return 'INVESTIGATION';
    }
    if (
      type === 'action_proposed' ||
      type === 'remediation_proposed' ||
      type === 'new_remediation_proposed'
    ) {
      return 'PROPOSAL';
    }
    if (type === 'policy_decision' || type === 'approval_rejected_by_policy') {
      return 'POLICY_GATE';
    }
    if (type === 'approval_requested' || type === 'human_approval_decision') {
      return 'HUMAN_APPROVAL';
    }
    if (type === 'tool_executed' || type === 'remediation_evaluation_started') {
      return 'EXECUTION';
    }
    if (
      type.startsWith('verification_') ||
      type === 'independent_verification_failed' ||
      type === 'recovery_invariant_failed'
    ) {
      return 'VERIFICATION';
    }
    if (type === 'outcome' || type === 'investigation_escalated') {
      return 'OUTCOME';
    }
    if (!KNOWN_EVENT_TYPES.has(type)) {
      return 'UNKNOWN';
    }
    return 'SYSTEM';
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
        return `Observed evidence [${p.id || 'EVD'}] (${p.source || 'telemetry'}): ${p.description || p.summary || p.kind || ''}`;
      case 'evidence_correlated':
        return `Correlated [${p.evidence_id || 'EVD'}]: supports [${(Array.isArray(p.supporting_hypotheses) ? p.supporting_hypotheses : []).join(', ') || 'none'}], contradicts [${(Array.isArray(p.contradicting_hypotheses) ? p.contradicting_hypotheses : []).join(', ') || 'none'}]`;
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

  // Filter events accurately
  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      const p = ev.payload || {};

      // 1. Category Filter
      if (categoryFilter !== 'ALL') {
        const cat = getEventCategory(ev.type);
        if (cat !== categoryFilter) return false;
      }

      // 2. Policy Filter
      if (policyFilter !== 'ALL') {
        if (ev.type === 'policy_decision') {
          if (p.decision !== policyFilter) return false;
        } else if (ev.type === 'approval_rejected_by_policy') {
          if (policyFilter !== 'REJECTED') return false;
        } else {
          return false;
        }
      }

      // 3. Execution Filter
      if (executionFilter !== 'ALL') {
        if (ev.type === 'tool_executed') {
          const success = Boolean(p.success);
          if (executionFilter === 'SUCCESS' && !success) return false;
          if (executionFilter === 'FAILED' && success) return false;
        } else {
          return false;
        }
      }

      // 4. Verification Filter
      if (verificationFilter !== 'ALL') {
        if (ev.type === 'verification_result') {
          const passed = Boolean(p.all_passed);
          if (verificationFilter === 'PASSED' && !passed) return false;
          if (verificationFilter === 'FAILED' && passed) return false;
        } else if (ev.type === 'verification_check') {
          const passed = Boolean(p.passed);
          if (verificationFilter === 'PASSED' && !passed) return false;
          if (verificationFilter === 'FAILED' && passed) return false;
        } else {
          return false;
        }
      }

      // 5. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const summary = getEventSummary(ev).toLowerCase();
        const type = ev.type.toLowerCase();
        const actor = ev.actor.toLowerCase();
        const payloadStr = JSON.stringify(p).toLowerCase();
        if (!summary.includes(q) && !type.includes(q) && !actor.includes(q) && !payloadStr.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [events, categoryFilter, policyFilter, executionFilter, verificationFilter, searchQuery]);

  return (
    <div className="panel flex-1 flex flex-col gap-3" data-testid="event-timeline">
      {/* Panel Header */}
      <div className="panel-header flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#DFD7C7] pb-3">
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
            {filteredEvents.length} / {events.length} {events.length === 1 ? 'EVENT' : 'EVENTS'}
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

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-2 pt-1">
        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center justify-between">
          {/* Search Input */}
          <div className="relative flex-1 max-w-sm">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#827869]" />
            <input
              type="text"
              placeholder="Search event type, summary, tool or payload..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 py-1 text-[11px] font-mono"
            />
          </div>

          {/* Quick Category Buttons */}
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[10px] font-mono text-[#6B6255] uppercase mr-0.5">Category:</span>
            {['ALL', 'PROPOSAL', 'POLICY_GATE', 'HUMAN_APPROVAL', 'EXECUTION', 'VERIFICATION', 'OUTCOME'].map(
              (cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    setCategoryFilter(cat);
                    setPolicyFilter('ALL');
                    setExecutionFilter('ALL');
                    setVerificationFilter('ALL');
                  }}
                  className={`px-2 py-0.5 text-[9px] font-mono font-bold uppercase transition-colors ${
                    categoryFilter === cat
                      ? 'bg-[#1C1917] text-[#FAF6F0]'
                      : 'bg-[#ECE6DC] text-[#6B6255] hover:text-[#1C1917]'
                  }`}
                >
                  {cat.replace('_', ' ')}
                </button>
              )
            )}
          </div>
        </div>

        {/* Specialized Secondary Filters if Policy / Execution / Verification active */}
        {categoryFilter === 'POLICY_GATE' && (
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#6B6255] bg-[#ECE6DC] p-1.5 border border-[#DFD7C7]">
            <span className="uppercase font-bold">Policy Outcome:</span>
            {['ALL', 'ALLOWED', 'APPROVAL_REQUIRED', 'BLOCKED', 'REJECTED'].map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setPolicyFilter(opt)}
                className={`px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                  policyFilter === opt ? 'bg-[#1C1917] text-[#FAF6F0]' : 'hover:underline text-[#0E7490]'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        )}

        {categoryFilter === 'EXECUTION' && (
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#6B6255] bg-[#ECE6DC] p-1.5 border border-[#DFD7C7]">
            <span className="uppercase font-bold">Execution Result:</span>
            {['ALL', 'SUCCESS', 'FAILED'].map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setExecutionFilter(opt)}
                className={`px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                  executionFilter === opt ? 'bg-[#1C1917] text-[#FAF6F0]' : 'hover:underline text-[#0E7490]'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        )}

        {categoryFilter === 'VERIFICATION' && (
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#6B6255] bg-[#ECE6DC] p-1.5 border border-[#DFD7C7]">
            <span className="uppercase font-bold">Verification Outcome:</span>
            {['ALL', 'PASSED', 'FAILED'].map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setVerificationFilter(opt)}
                className={`px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                  verificationFilter === opt ? 'bg-[#1C1917] text-[#FAF6F0]' : 'hover:underline text-[#0E7490]'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Empty State */}
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
      ) : filteredEvents.length === 0 ? (
        <div className="p-8 text-center text-[#827869] font-mono text-xs">
          No audit events match the selected filters.
        </div>
      ) : (
        <div className="timeline-container">
          {filteredEvents.map((event, idx) => {
            const isExpanded = expandedEvents.has(event.event_id || `idx-${idx}`);
            const actorClass = ACTOR_BADGE_CLASSES[event.actor] || 'badge-synthetic';
            const isUnknownType = !KNOWN_EVENT_TYPES.has(event.type);
            const isInjectionAlert = event.type === 'injection_detected';
            const p = event.payload || {};

            return (
              <div
                key={event.event_id || `evt-${idx}`}
                className={`timeline-item ${
                  isInjectionAlert ? 'border-l-4 border-l-red-600 bg-red-50/20' : ''
                }`}
                data-testid={`event-item-${event.event_id || idx}`}
              >
                <div className="timeline-item-header">
                  <div className="timeline-meta flex items-center gap-1.5 flex-wrap">
                    <span className="timeline-sequence font-mono">
                      #{event.sequence !== undefined ? event.sequence : idx + 1}
                    </span>
                    <span className={`badge font-mono text-[10px] ${actorClass}`}>{event.actor}</span>
                    <span
                      className={`badge font-mono text-[10px] ${
                        isUnknownType
                          ? 'badge-amber'
                          : isInjectionAlert
                          ? 'badge-rose'
                          : 'badge-synthetic'
                      }`}
                    >
                      {event.type}
                    </span>
                    {isUnknownType && (
                      <span className="badge badge-synthetic font-mono text-[9px] text-amber-800">
                        UNKNOWN TYPE
                      </span>
                    )}
                  </div>
                  <span className="timeline-timestamp font-mono">
                    {event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : ''}
                  </span>
                </div>

                {/* Event Summary with safe text handling */}
                <div
                  className={`timeline-summary font-sans text-xs ${
                    isInjectionAlert ? 'font-bold text-red-900' : ''
                  }`}
                >
                  {getEventSummary(event)}
                </div>

                {/* Untrusted Log Content Warning if logs present */}
                {event.type === 'evidence_collected' && p.excerpt && (
                  <div className="mt-1.5 p-2 bg-[#FAF6F0] border border-[#DFD7C7] text-[11px] font-mono">
                    <div className="flex items-center gap-1 text-[10px] text-[#827869] uppercase font-bold mb-1">
                      <Lock className="w-3 h-3 text-[#B45309]" />
                      <span>Untrusted Raw Log Excerpts (Passive Text Only):</span>
                    </div>
                    <pre className="text-[10px] text-[#1C1917] whitespace-pre-wrap font-mono max-h-32 overflow-y-auto">
                      {Array.isArray(p.excerpt) ? p.excerpt.join('\n') : String(p.excerpt)}
                    </pre>
                  </div>
                )}

                {/* Evidence References */}
                {event.evidence_refs && event.evidence_refs.length > 0 && (
                  <div className="flex gap-1.5 mb-2 flex-wrap">
                    {event.evidence_refs.map((ref) => (
                      <span key={ref} className="badge badge-synthetic font-mono text-[10px]">
                        🔗 {ref}
                      </span>
                    ))}
                  </div>
                )}

                {/* Expand / Collapse Structured Payload */}
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
                  <pre className="payload-json text-xs">
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
