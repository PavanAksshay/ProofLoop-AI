import React from 'react';
import { ShieldCheck, Activity, Terminal } from 'lucide-react';
import { HealthResponse } from '../types';

interface HeaderProps {
  health: HealthResponse | null;
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'completed';
  hasActiveIncident?: boolean;
  onRefreshHistory: () => void;
  onOpenHistory: () => void;
  activeView?: 'operations' | 'benchmark';
  onSelectView?: (view: 'operations' | 'benchmark') => void;
}

export const Header: React.FC<HeaderProps> = ({
  connectionStatus,
  hasActiveIncident = false,
  onOpenHistory,
  activeView = 'operations',
  onSelectView,
}) => {
  return (
    <header className="w-full bg-[#FAF6F0] border-b border-[#DFD7C7] sticky top-0 z-50 flex justify-center py-3.5">
      <div className="w-full max-w-6xl mx-auto px-6 flex items-center justify-between gap-4">
        {/* Brand - lowered, spacious, no wrapping */}
        <div className="flex items-center justify-start gap-3 flex-shrink-0">
          <div className="w-8 h-8 bg-[#1C1917] flex items-center justify-center text-white font-mono font-bold text-sm flex-shrink-0">
            <ShieldCheck className="w-5 h-5 text-cyan-400" />
          </div>
          <div className="whitespace-nowrap">
            <div className="text-sm font-bold tracking-tight text-[#1C1917] font-mono uppercase leading-tight">
              PROOFLOOP AI
            </div>
            <div className="text-[10px] text-[#6B6255] font-mono tracking-widest uppercase leading-tight">
              AgentOps Governance & Verification
            </div>
          </div>
        </div>

        {/* Sharp View Navigation - Centered */}
        {onSelectView && (
          <div className="flex items-center justify-center flex-shrink-0">
            <nav className="flex items-center border border-[#DFD7C7] divide-x divide-[#DFD7C7] bg-[#ECE6DC]" aria-label="Main Navigation">
              <button
                type="button"
                onClick={() => onSelectView('operations')}
                className={`px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider transition-colors flex items-center gap-2 ${
                  activeView === 'operations'
                    ? 'bg-[#1C1917] text-[#FAF6F0]'
                    : 'bg-transparent text-[#6B6255] hover:text-[#1C1917] hover:bg-[#FAF6F0]'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>// 01 LIVE OPERATIONS</span>
              </button>
              <button
                type="button"
                onClick={() => onSelectView('benchmark')}
                className={`px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider transition-colors flex items-center gap-2 ${
                  activeView === 'benchmark'
                    ? 'bg-[#1C1917] text-[#FAF6F0]'
                    : 'bg-transparent text-[#6B6255] hover:text-[#1C1917] hover:bg-[#FAF6F0]'
                }`}
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>// 02 BENCHMARK OPERATOR</span>
              </button>
            </nav>
          </div>
        )}

        {/* Technical Status Bar - Clean, MODE removed, Smart SSE state */}
        <div className="flex items-center justify-end gap-3 flex-shrink-0">
          {/* SSE Stream State Badge */}
          <span
            className={`badge font-mono text-[11px] ${
              connectionStatus === 'connected'
                ? 'badge-emerald'
                : connectionStatus === 'connecting'
                ? 'badge-amber'
                : connectionStatus === 'completed'
                ? 'badge-cyan'
                : hasActiveIncident
                ? 'badge-rose'
                : 'badge-synthetic'
            }`}
            title={
              connectionStatus === 'connected'
                ? 'Live SSE event stream active'
                : connectionStatus === 'connecting'
                ? 'Establishing SSE connection...'
                : connectionStatus === 'completed'
                ? 'Incident run completed'
                : hasActiveIncident
                ? 'SSE connection lost'
                : 'SSE stream is in standby. Connects dynamically during incident execution.'
            }
          >
            {connectionStatus === 'connected' && <span className="pulse-dot" />}
            {connectionStatus === 'connecting' && <span className="pulse-dot" />}
            {connectionStatus === 'connected'
              ? 'SSE: STREAMING'
              : connectionStatus === 'connecting'
              ? 'SSE: CONNECTING'
              : connectionStatus === 'completed'
              ? 'SSE: COMPLETED'
              : hasActiveIncident
              ? 'SSE: DISCONNECTED'
              : 'SSE: STANDBY'}
          </span>

          {/* History Button */}
          <button
            type="button"
            className="btn btn-secondary font-mono text-xs py-1.5 px-3 uppercase tracking-wider"
            onClick={onOpenHistory}
            title="Open incident history log"
          >
            <span>📜</span>
            <span>INCIDENTS</span>
          </button>
        </div>
      </div>
    </header>
  );
};
