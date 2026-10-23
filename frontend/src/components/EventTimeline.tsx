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
      case 'evidence_collected':
        return `Evidence collected from ${p.source || 'checkout-service'}: ${Array.isArray(p.excerpt) ? p.excerpt.length : 0} log entries parsed.`;
      case 'injection_detected':
        return `🚨 Instruction-like content found in untrusted logs. Treated strictly as data; authorization unchanged.`;
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
      case 'verification_check':
        return `Independent check: ${p.check_name} -> ${p.passed ? 'PASSED' : 'FAILED'}`;
      case 'verification_result':
        return `Independent verification summary: ${p.all_passed ? 'ALL CHECKS PASSED' : 'CHECKS FAILED'}`;
      case 'investigation_limit_reached':
        return `Investigation limit exhausted (${p.limit || 8} steps). Halting automated actions.`;
      case 'outcome':
        return `Terminal incident outcome: ${p.outcome}. ${p.summary || ''}`;
      case 'worker_error':
        return `Background worker error: ${p.error_type || 'Unknown'}`;
      default:
        return JSON.stringify(p);
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
