import React from 'react';
import { AgentNodeId, AgentNodeRuntimeState } from '../../types/agent-engine';
import {
  Cpu,
  Search,
  GitBranch,
  ShieldAlert,
  Wrench,
  CheckCircle2,
  ChevronRight,
  Clock,
  AlertTriangle,
  Check,
  Ban,
  Activity,
} from 'lucide-react';

interface AgentStatusRailProps {
  nodes: Record<AgentNodeId, AgentNodeRuntimeState>;
  selectedNodeId: AgentNodeId | null;
  onSelectNode: (nodeId: AgentNodeId) => void;
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

const STATUS_CONFIG: Record<
  AgentNodeRuntimeState['status'],
  { label: string; badgeClass: string; icon: React.FC<{ className?: string }> }
> = {
  idle: {
    label: 'STANDBY',
    badgeClass: 'bg-[#ECE6DC] text-[#6B6255] border-[#DFD7C7]',
    icon: Clock,
  },
  waiting: {
    label: 'WAITING / GATE',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-300 animate-pulse',
    icon: Clock,
  },
  active: {
    label: 'ACTIVE',
    badgeClass: 'bg-teal-50 text-teal-800 border-teal-300',
    icon: Activity,
  },
  completed: {
    label: 'VERIFIED',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-300',
    icon: Check,
  },
  failed: {
    label: 'FAILED',
    badgeClass: 'bg-rose-50 text-rose-800 border-rose-300',
    icon: AlertTriangle,
  },
  blocked: {
    label: 'BLOCKED',
    badgeClass: 'bg-rose-100 text-rose-900 border-rose-300',
    icon: Ban,
  },
};

const ORDERED_NODES: AgentNodeId[] = [
  'orchestrator',
  'investigation',
  'hypothesis',
  'policy',
  'remediation',
  'verification',
];

export const AgentStatusRail: React.FC<AgentStatusRailProps> = ({
  nodes,
  selectedNodeId,
  onSelectNode,
  className = '',
}) => {
  return (
    <div
      className={`flex flex-col bg-[#FAF6F0] border border-[#DFD7C7] rounded overflow-hidden select-none shadow-sm ${className}`}
      role="region"
      aria-label="Agent Nodes Status Rail"
    >
      <div className="px-3.5 py-2.5 bg-[#ECE6DC] border-b border-[#DFD7C7] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#1C1917]" />
          <span className="text-[11px] font-mono font-bold tracking-wider text-[#1C1917] uppercase">
            OPERATIONAL NODES
          </span>
        </div>
        <span className="text-[10px] font-mono text-[#6B6255]">6 BLACK ORBS</span>
      </div>

      <div className="divide-y divide-[#DFD7C7] flex flex-col bg-[#FAF6F0]">
        {ORDERED_NODES.map((nodeId) => {
          const node = nodes[nodeId];
          const Icon = ICONS[nodeId];
          const isSelected = selectedNodeId === nodeId;
          const statusCfg = STATUS_CONFIG[node.status];
          const StatusIcon = statusCfg.icon;

          return (
            <button
              key={nodeId}
              type="button"
              onClick={() => onSelectNode(nodeId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectNode(nodeId);
                }
              }}
              className={`w-full text-left px-3.5 py-3 flex items-center justify-between transition-all group ${
                isSelected
                  ? 'bg-[#FFFFFF] border-l-4 border-[#1C1917] shadow-sm'
                  : 'hover:bg-[#ECE6DC]/50 border-l-4 border-transparent'
              }`}
              aria-pressed={isSelected}
              aria-label={`Select ${node.label} agent`}
            >
              <div className="flex items-center gap-3 min-w-0">
                {/* 3D Black Orb Indicator */}
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                    isSelected
                      ? 'bg-[#18181B] text-[#FAF6F0] ring-2 ring-[#1C1917]'
                      : 'bg-[#18181B] text-[#DFD7C7] group-hover:scale-105'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-xs font-mono font-bold uppercase truncate transition-colors ${
                        isSelected ? 'text-[#1C1917]' : 'text-[#292524] group-hover:text-[#1C1917]'
                      }`}
                    >
                      {node.label}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-[#6B6255] truncate">{node.stage}</div>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-mono uppercase font-semibold border rounded ${statusCfg.badgeClass}`}
                >
                  <StatusIcon className="w-2.5 h-2.5" />
                  {statusCfg.label}
                </span>
                <ChevronRight
                  className={`w-3.5 h-3.5 text-[#6B6255] transition-transform ${
                    isSelected ? 'translate-x-0.5 text-[#1C1917]' : 'opacity-40 group-hover:opacity-100'
                  }`}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
