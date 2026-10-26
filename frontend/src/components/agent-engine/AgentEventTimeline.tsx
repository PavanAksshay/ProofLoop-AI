import React, { useRef, useEffect } from 'react';
import { Event } from '../../types';
import { AgentNodeId } from '../../types/agent-engine';
import {
  Activity,
  Search,
  GitBranch,
  ShieldAlert,
  Wrench,
  CheckCircle2,
  Cpu,
  Wifi,
  WifiOff,
  Radio,
} from 'lucide-react';

interface AgentEventTimelineProps {
  events: Event[];
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'completed';
  className?: string;
  onSelectNodeByActor?: (nodeId: AgentNodeId) => void;
}

const ACTOR_MAP: Record<string, { label: string; nodeId: AgentNodeId; icon: React.FC<{ className?: string }> }> = {
  incident_opened: { label: 'ORCHESTRATOR', nodeId: 'orchestrator', icon: Cpu },
  investigation_started: { label: 'INVESTIGATION', nodeId: 'investigation', icon: Search },
  diagnostic_selected: { label: 'INVESTIGATION', nodeId: 'investigation', icon: Search },
  evidence_ingested: { label: 'INVESTIGATION', nodeId: 'investigation', icon: Search },
  hypothesis_created: { label: 'HYPOTHESIS', nodeId: 'hypothesis', icon: GitBranch },
  action_proposed: { label: 'REMEDIATION', nodeId: 'remediation', icon: Wrench },
  policy_decision: { label: 'POLICY', nodeId: 'policy', icon: ShieldAlert },
  approval_requested: { label: 'POLICY GATE', nodeId: 'policy', icon: ShieldAlert },
  approval_submitted: { label: 'POLICY GATE', nodeId: 'policy', icon: ShieldAlert },
  tool_executed: { label: 'REMEDIATION', nodeId: 'remediation', icon: Wrench },
  verification_check: { label: 'VERIFICATION', nodeId: 'verification', icon: CheckCircle2 },
  verification_result: { label: 'VERIFICATION', nodeId: 'verification', icon: CheckCircle2 },
  replanning_started: { label: 'ORCHESTRATOR', nodeId: 'orchestrator', icon: Cpu },
  outcome: { label: 'ORCHESTRATOR', nodeId: 'orchestrator', icon: Cpu },
};

function formatEventSummary(evt: Event): string {
  const p = evt.payload || {};
  switch (evt.type) {
    case 'incident_opened':
      return `Incident initialized: ${p.title || p.scenario || 'Operational fault'}`;
    case 'investigation_started':
      return `Symptoms analyzed: ${Array.isArray(p.symptoms) ? p.symptoms.join(', ') : 'Telemetry anomaly'}`;
    case 'diagnostic_selected':
      return `Executing diagnostic: ${p.tool_name || p.diagnostic || 'EIV Tool'}`;
    case 'evidence_ingested':
      return `Evidence artifact logged: ${p.source || p.key || 'metric log'}`;
    case 'hypothesis_created':
      return `Hypothesis formulated: ${p.title || p.theory || 'Root cause theory'} (${Math.round((p.likelihood ?? 0.5) * 100)}% conf)`;
    case 'action_proposed':
      return `Proposed remediation: ${p.action || p.remediation || 'Safe mutation'}`;
    case 'policy_decision':
      return `Policy rule evaluated: ${p.decision || 'allow'} (${p.reason || 'Client invariant satisfied'})`;
    case 'approval_requested':
      return `HALTED AT POLICY GATE: Human approval requested for ${p.action || 'action'}`;
    case 'approval_submitted':
      return `Approval submitted: ${p.decision || 'approved'} by ${p.author || 'operator'}`;
    case 'tool_executed':
      return `Tool executed in sandbox: ${p.tool || 'remediation action'}`;
    case 'verification_check':
      return `Independent check: ${p.name || p.check || 'Invariant probe'} -> ${p.passed ? 'PASSED' : 'FAILED'}`;
    case 'verification_result':
      return `Verification completed: ${p.verified ? 'ALL INVARIANTS SATISFIED' : 'REJECTED (FALSE GREEN PREVENTED)'}`;
    case 'replanning_started':
      return `Replanning cycle triggered: ${p.reason || 'Hypothesis refuted, attempting alternative'}`;
    case 'outcome':
      return `Terminal outcome reached: ${p.status || p.outcome || 'RESOLVED'}`;
    default:
      return `${evt.type}: ${JSON.stringify(p).slice(0, 80)}`;
  }
}

export const AgentEventTimeline: React.FC<AgentEventTimelineProps> = ({
  events,
  connectionStatus,
  className = '',
  onSelectNodeByActor,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  return (
    <div
      className={`bg-[#FAF6F0] border border-[#DFD7C7] rounded flex flex-col select-none shadow-sm ${className}`}
      role="region"
      aria-label="Agent Activity Event Stream"
    >
      {/* Header */}
      <div className="px-3.5 py-2.5 bg-[#ECE6DC] border-b border-[#DFD7C7] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-teal-700" />
          <span className="text-[11px] font-mono font-bold tracking-wider text-[#1C1917] uppercase">
            INCIDENT EVENT STREAM
          </span>
          <span className="text-[10px] font-mono text-[#6B6255]">({events.length} events)</span>
        </div>

        {/* SSE Stream Status Indicator */}
        <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase px-2 py-0.5 rounded border border-[#DFD7C7] bg-[#FFFFFF] shadow-xs">
          {connectionStatus === 'connected' ? (
            <>
              <Radio className="w-2.5 h-2.5 text-emerald-600 animate-pulse" />
              <span className="text-emerald-700 font-bold">LIVE SSE</span>
            </>
          ) : connectionStatus === 'connecting' ? (
            <>
              <Wifi className="w-2.5 h-2.5 text-amber-600 animate-spin" />
              <span className="text-amber-700 font-bold">CONNECTING</span>
            </>
          ) : connectionStatus === 'completed' ? (
            <>
              <CheckCircle2 className="w-2.5 h-2.5 text-teal-600" />
              <span className="text-[#6B6255] font-bold">ARCHIVED</span>
            </>
          ) : events.length === 0 ? (
            <>
              <WifiOff className="w-2.5 h-2.5 text-[#6B6255]" />
              <span className="text-[#6B6255] font-bold">STANDBY</span>
            </>
          ) : (
            <>
              <WifiOff className="w-2.5 h-2.5 text-[#6B6255]" />
              <span className="text-[#6B6255] font-bold">DISCONNECTED</span>
            </>
          )}
        </div>
      </div>

      {/* Events List */}
      <div
        ref={scrollRef}
        className="p-2 space-y-1.5 overflow-y-auto max-h-[220px] font-mono text-xs divide-y divide-[#DFD7C7]/50 bg-[#FAF6F0]"
      >
        {events.length === 0 ? (
          <div className="py-6 text-center text-[#6B6255] text-xs">
            Awaiting incident lifecycle events...
          </div>
        ) : (
          events.map((evt, idx) => {
            const actor = ACTOR_MAP[evt.type] || {
              label: 'SYSTEM',
              nodeId: 'orchestrator',
              icon: Cpu,
            };
            const ActorIcon = actor.icon;

            return (
              <div
                key={evt.event_id || `${evt.sequence}-${idx}`}
                className="pt-1.5 first:pt-0 flex items-start gap-2 hover:bg-[#FFFFFF]/70 p-1.5 rounded transition-colors group"
              >
                <span className="text-[9px] text-[#6B6255] w-6 flex-shrink-0 mt-0.5 font-bold">
                  #{evt.sequence ?? idx + 1}
                </span>

                <button
                  type="button"
                  onClick={() => onSelectNodeByActor?.(actor.nodeId)}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold bg-[#18181B] text-[#FAF6F0] hover:bg-[#27272A] transition-colors flex-shrink-0 uppercase shadow-xs"
                  title={`Inspect ${actor.label}`}
                >
                  <ActorIcon className="w-2.5 h-2.5" />
                  {actor.label}
                </button>

                <div className="min-w-0 flex-1">
                  <span className="text-[#1C1917] text-[11px] leading-tight block break-words">
                    {formatEventSummary(evt)}
                  </span>
                  {evt.timestamp && (
                    <span className="text-[9px] text-[#6B6255] block mt-0.5">
                      {new Date(evt.timestamp).toLocaleTimeString()}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
