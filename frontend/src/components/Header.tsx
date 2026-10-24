import React from 'react';
import { ShieldCheck, Activity, Terminal, Compass, History, ShieldAlert } from 'lucide-react';
import { HealthResponse } from '../types';

export type ActiveViewKey = 'operations' | 'investigations' | 'incidents' | 'approvals' | 'benchmark';

interface HeaderProps {
  health?: HealthResponse | null;
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'completed';
  hasActiveIncident?: boolean;
  onRefreshHistory: () => void;
  onOpenHistory: () => void;
  activeView?: ActiveViewKey;
  onSelectView?: (view: ActiveViewKey) => void;
  pendingApprovalsCount?: number;
}

export const Header: React.FC<HeaderProps> = ({
  connectionStatus,
  hasActiveIncident = false,
  onOpenHistory,
  activeView = 'operations',
  onSelectView,
  pendingApprovalsCount = 0,
}) => {
  return (
    <header className="w-full bg-[#FAF6F0] border-b border-[#DFD7C7] sticky top-0 z-50 flex justify-center py-3">
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Brand */}
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

        {/* Sharp View Navigation - Centered & Responsive */}
        {onSelectView && (
          <div className="flex items-center justify-center flex-wrap overflow-x-auto max-w-full">
            <nav
              className="flex items-center border border-[#DFD7C7] divide-x divide-[#DFD7C7] bg-[#ECE6DC]"
              aria-label="Main Navigation"
            >
              <button
                type="button"
                onClick={() => onSelectView('operations')}
                className={`px-3 py-1.5 text-xs font-mono font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5 ${
                  activeView === 'operations'
                    ? 'bg-[#1C1917] text-[#FAF6F0]'
                    : 'bg-transparent text-[#6B6255] hover:text-[#1C1917] hover:bg-[#FAF6F0]'
                }`}
                aria-label="Live Operations View"
              >
                <Activity className="w-3.5 h-3.5" />
                <span>// 01 OPERATIONS</span>
              </button>

              <button
                type="button"
                onClick={() => onSelectView('investigations')}
                className={`px-3 py-1.5 text-xs font-mono font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5 ${
                  activeView === 'investigations'
                    ? 'bg-[#1C1917] text-[#FAF6F0]'
                    : 'bg-transparent text-[#6B6255] hover:text-[#1C1917] hover:bg-[#FAF6F0]'
                }`}
                aria-label="Investigations View"
              >
                <Compass className="w-3.5 h-3.5" />
                <span>// 02 INVESTIGATIONS</span>
              </button>

              <button
                type="button"
                onClick={() => onSelectView('incidents')}
                className={`px-3 py-1.5 text-xs font-mono font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5 ${
                  activeView === 'incidents'
                    ? 'bg-[#1C1917] text-[#FAF6F0]'
                    : 'bg-transparent text-[#6B6255] hover:text-[#1C1917] hover:bg-[#FAF6F0]'
                }`}
                aria-label="Incidents View"
              >
                <History className="w-3.5 h-3.5" />
                <span>// 03 INCIDENTS</span>
              </button>

              <button
                type="button"
                onClick={() => onSelectView('approvals')}
                className={`px-3 py-1.5 text-xs font-mono font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5 relative ${
                  activeView === 'approvals'
                    ? 'bg-[#1C1917] text-[#FAF6F0]'
                    : 'bg-transparent text-[#6B6255] hover:text-[#1C1917] hover:bg-[#FAF6F0]'
                }`}
                aria-label="Approvals View"
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>// 04 APPROVALS</span>
                {pendingApprovalsCount > 0 && (
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse ml-0.5" />
                )}
              </button>

              <button
                type="button"
                onClick={() => onSelectView('benchmark')}
                className={`px-3 py-1.5 text-xs font-mono font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5 ${
                  activeView === 'benchmark'
                    ? 'bg-[#1C1917] text-[#FAF6F0]'
                    : 'bg-transparent text-[#6B6255] hover:text-[#1C1917] hover:bg-[#FAF6F0]'
                }`}
                aria-label="Benchmark View"
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>// 05 BENCHMARK</span>
              </button>
            </nav>
          </div>
        )}

        {/* Technical Status Bar */}
        <div className="flex items-center justify-end gap-2.5 flex-shrink-0">
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

          {/* History Drawer Quick-Trigger */}
          <button
            type="button"
            className="btn btn-secondary font-mono text-xs py-1 px-2.5 uppercase tracking-wider"
            onClick={onOpenHistory}
            title="Open incident history drawer"
          >
            <span>📜</span>
            <span>DRAWER</span>
          </button>
        </div>
      </div>
    </header>
  );
};
