import React from 'react';
import { AgentNodeId, NormalizedEngineState } from '../../types/agent-engine';
import { AGENT_METADATA, getStatusColor, AGENT_PALETTE } from '../../lib/agentEngineAdapter';
import {
  Compass,
  Cpu,
  GitBranch,
  ShieldAlert,
  Wrench,
  CheckCircle2,
} from 'lucide-react';

interface AgentFallback2DProps {
  state: NormalizedEngineState;
  selectedNodeId: AgentNodeId | null;
  onSelectNode: (id: AgentNodeId) => void;
  className?: string;
}

const ICONS: Record<AgentNodeId, React.FC<{ className?: string }>> = {
  orchestrator: Cpu,
  investigation: Compass,
  hypothesis: GitBranch,
  policy: ShieldAlert,
  remediation: Wrench,
  verification: CheckCircle2,
};

// 2D Normalized Coordinates for SVG Canvas (viewBox: 0 0 800 500)
const NODE_2D_POSITIONS: Record<AgentNodeId, { x: number; y: number }> = {
  orchestrator: { x: 400, y: 250 },
  investigation: { x: 180, y: 170 },
  hypothesis: { x: 280, y: 80 },
  policy: { x: 520, y: 80 },
  remediation: { x: 620, y: 170 },
  verification: { x: 400, y: 400 },
};

export const AgentFallback2D: React.FC<AgentFallback2DProps> = ({
  state,
  selectedNodeId,
  onSelectNode,
  className = '',
}) => {
  return (
    <div
      className={`relative w-full h-full min-h-[420px] bg-[#F5EFEB] border border-[#DFD7C7] flex flex-col justify-between overflow-hidden select-none ${className}`}
      data-testid="agent-engine-2d-fallback"
    >
      {/* Background Architectural Grid */}
      <div
        className="absolute inset-0 opacity-40 pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(${AGENT_PALETTE.gridLines} 1.5px, transparent 1.5px)`,
          backgroundSize: '24px 24px',
        }}
      />

      {/* Mode Indicator & HUD Headers */}
      <div className="absolute top-3 inset-x-4 z-10 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-2 bg-[#FAF6F0]/90 backdrop-blur border border-[#DFD7C7] px-2.5 py-1 rounded shadow-sm">
          <span className="w-2 h-2 bg-[#18181B] rounded-full animate-pulse" />
          <span className="text-[10px] font-mono tracking-widest text-[#1C1917] uppercase font-bold">
            PRECISION 2D TOPOLOGY ENGINE // ACCESSIBLE FALLBACK
          </span>
        </div>

        <div className="bg-[#FAF6F0]/90 backdrop-blur border border-[#DFD7C7] px-3 py-1 rounded shadow-sm flex items-center gap-2">
          <span className="text-[9px] font-mono text-[#6B6255] uppercase">STAGE:</span>
          <span className="text-[10px] font-mono text-[#1C1917] font-bold uppercase truncate max-w-[200px]">
            {state.currentWorkflowStage}
          </span>
        </div>
      </div>

      {/* SVG Canvas for Conduits & Nodes */}
      <svg
        className="w-full h-full flex-1"
        viewBox="0 0 800 500"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Agent Operations Engine 2D Topology Diagram"
      >
        {/* Conduit Lines */}
        {state.conduits.map((conduit) => {
          const fromPos = NODE_2D_POSITIONS[conduit.from];
          const toPos = NODE_2D_POSITIONS[conduit.to];
          const isSelected = selectedNodeId === conduit.from || selectedNodeId === conduit.to;
          const strokeColor = conduit.isActive
            ? getStatusColor(conduit.status)
            : isSelected
            ? '#1C1917'
            : '#DFD7C7';
          const strokeWidth = conduit.isActive ? 2.5 : 1.5;
          const strokeDash = conduit.status === 'waiting' ? '4 4' : undefined;

          return (
            <g key={`${conduit.from}-${conduit.to}`}>
              <line
                x1={fromPos.x}
                y1={fromPos.y}
                x2={toPos.x}
                y2={toPos.y}
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                strokeDasharray={strokeDash}
                opacity={conduit.isActive ? 0.95 : 0.6}
              />
              {/* Active Pulse indicator on line midpoint */}
              {conduit.isActive && (
                <circle
                  cx={(fromPos.x + toPos.x) / 2}
                  cy={(fromPos.y + toPos.y) / 2}
                  r="4"
                  fill={getStatusColor(conduit.status)}
                />
              )}
            </g>
          );
        })}

        {/* Dynamic Center Gyroscope Axis Lines */}
        <circle
          cx="400"
          cy="250"
          r="105"
          fill="none"
          stroke="#DFD7C7"
          strokeWidth="1"
          strokeDasharray="2 4"
          opacity={0.7}
        />

        {/* Agent Black Orbs in 2D */}
        {(Object.keys(NODE_2D_POSITIONS) as AgentNodeId[]).map((nodeId) => {
          const meta = AGENT_METADATA[nodeId];
          const nodeState = state.nodes[nodeId];
          const pos = NODE_2D_POSITIONS[nodeId];
          const isSelected = selectedNodeId === nodeId;
          const isActive = state.activeNodeId === nodeId || nodeState.status === 'active';
          const nodeColor = getStatusColor(nodeState.status);
          const Icon = ICONS[nodeId];
          const isOrchestrator = nodeId === 'orchestrator';
          const nodeRadius = isOrchestrator ? 42 : 36;

          return (
            <g
              key={nodeId}
              tabIndex={0}
              role="button"
              aria-label={`${meta.label}: ${nodeState.statusLabel}`}
              aria-pressed={isSelected}
              onClick={() => onSelectNode(nodeId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectNode(nodeId);
                }
              }}
              className="cursor-pointer focus:outline-none group"
            >
              {/* Outer Status Ring */}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={nodeRadius + 6}
                fill="none"
                stroke={nodeColor}
                strokeWidth={isActive || isSelected ? 2.5 : 1.2}
                strokeDasharray={isSelected ? '3 3' : undefined}
                opacity={isActive ? 1.0 : isSelected ? 0.9 : 0.4}
              />

              {/* 3D Black Orb Core (2D representation) */}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={nodeRadius}
                fill="#18181B" // Obsidian black orb
                stroke={isSelected ? '#1C1917' : '#27272A'}
                strokeWidth={1.5}
                className="transition-all duration-200 group-hover:scale-105"
              />

              {/* Specular Sheen Gradient simulation on black orb */}
              <ellipse
                cx={pos.x - nodeRadius * 0.25}
                cy={pos.y - nodeRadius * 0.3}
                rx={nodeRadius * 0.45}
                ry={nodeRadius * 0.25}
                fill="#FFFFFF"
                opacity="0.12"
              />

              {/* Node Center Icon */}
              <foreignObject
                x={pos.x - 10}
                y={pos.y - 10}
                width="20"
                height="20"
                className="pointer-events-none"
              >
                <div
                  className="w-full h-full flex items-center justify-center"
                  style={{ color: nodeColor }}
                >
                  <Icon className="w-4 h-4" />
                </div>
              </foreignObject>

              {/* Node Label Text in Obsidian Black */}
              <text
                x={pos.x}
                y={pos.y + nodeRadius + 18}
                textAnchor="middle"
                fill="#1C1917"
                fontSize="10"
                fontFamily="monospace"
                fontWeight="bold"
                letterSpacing="0.05em"
              >
                {meta.label}
              </text>

              {/* Status Badge Text */}
              <text
                x={pos.x}
                y={pos.y + nodeRadius + 30}
                textAnchor="middle"
                fill={nodeColor}
                fontSize="8.5"
                fontFamily="monospace"
                fontWeight="600"
              >
                [{nodeState.statusLabel}]
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};
