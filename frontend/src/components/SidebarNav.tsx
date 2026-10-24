import React from 'react';
import { TrendingUp, Activity, Compass, History, ShieldAlert, Terminal, Boxes } from 'lucide-react';

export type NavViewKey = 'dashboard' | 'operations' | 'agent_engine' | 'investigations' | 'incidents' | 'approvals' | 'benchmark';

interface SidebarNavProps {
  activeView: NavViewKey;
  onViewSelect: (view: NavViewKey) => void;
  isMobile?: boolean;
  onToggleMobile?: () => void;
}

const navItems = [
  { key: 'dashboard', icon: TrendingUp, label: 'DASHBOARD' },
  { key: 'operations', icon: Activity, label: 'LIVE OPERATIONS' },
  { key: 'agent_engine', icon: Boxes, label: '3D ENGINE' },
  { key: 'investigations', icon: Compass, label: 'INVESTIGATIONS' },
  { key: 'incidents', icon: History, label: 'INCIDENTS' },
  { key: 'approvals', icon: ShieldAlert, label: 'APPROVALS' },
  { key: 'benchmark', icon: Terminal, label: 'BENCHMARK' },
];

export const SidebarNav: React.FC<SidebarNavProps> = ({
  activeView,
  onViewSelect,
  isMobile,
}) => {
  return (
    <nav
      className={`fixed left-0 top-0 h-full w-16 sm:w-20 transition-all duration-300 ${
        isMobile ? 'transform -translate-x-full' : ''
      } ease-in-out z-40 bg-[#FAF6F0] border-r border-[#DFD7C7]`}
      aria-label="Main navigation"
    >
      <div className="h-full flex flex-col items-center justify-start pt-6 pb-6 gap-2">
        {navItems.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onViewSelect(item.key as NavViewKey)}
            className={`flex flex-col items-center gap-1.5 px-2 py-2 text-xs font-mono font-bold uppercase tracking-wider transition-colors select-none w-full ${
              activeView === item.key
                ? 'bg-[#1C1917] text-[#FAF6F0]'
                : 'text-[#6B6255] hover:bg-[#ECE6DC] hover:text-[#1C1917]'
            }`}
            aria-label={item.label}
          >
            <item.icon className="w-4 h-4 mx-auto" />
            <span className="text-center text-[9px] leading-tight">{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
};
