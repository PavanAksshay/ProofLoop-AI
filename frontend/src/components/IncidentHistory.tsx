import React from 'react';
import { History, RefreshCw, X } from 'lucide-react';
import { IncidentSummaryItem } from '../types';

interface IncidentHistoryProps {
  isOpen: boolean;
  onClose: () => void;
  incidents: IncidentSummaryItem[];
  isLoading: boolean;
  onSelectIncident: (incidentId: string) => void;
  onRefresh: () => void;
  selectedIncidentId: string | null;
}

export const IncidentHistory: React.FC<IncidentHistoryProps> = ({
  isOpen,
  onClose,
  incidents,
  isLoading,
  onSelectIncident,
  onRefresh,
  selectedIncidentId,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[85vh] flex flex-col bg-[#FAF6F0] border border-[#DFD7C7] shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center border-b border-[#DFD7C7] pb-3 mb-4">
          <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-[#1C1917] flex items-center gap-2">
            <History className="w-4 h-4 text-[#0E7490]" />
            <span>Persisted Incident History</span>
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 font-mono"
              onClick={onRefresh}
              disabled={isLoading}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>REFRESH</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary text-xs p-1.5 leading-none"
              onClick={onClose}
              aria-label="Close dialog"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 flex flex-col gap-2 pr-1">
          {isLoading && (
            <div className="text-zinc-500 font-mono text-xs text-center py-8">
              LOADING PERSISTED INCIDENTS...
            </div>
          )}

          {!isLoading && incidents.length === 0 && (
            <div className="text-zinc-500 font-mono text-xs text-center py-10">
              NO INCIDENTS FOUND IN PERSISTENCE STORE.
            </div>
          )}

          {incidents.map((item) => {
            const isSelected = item.incident_id === selectedIncidentId;
            return (
              <div
                key={item.incident_id}
                onClick={() => {
                  onSelectIncident(item.incident_id);
                  onClose();
                }}
                  className={`p-3 border cursor-pointer flex justify-between items-center transition-colors ${
                    isSelected
                      ? 'border-[#0E7490] bg-[#E4F0F2]'
                      : 'border-[#DFD7C7] bg-[#ECE6DC] hover:border-[#827869] hover:bg-[#E4DCCF]'
                  }`}
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold text-zinc-900">
                      {item.incident_id.slice(0, 16)}...
                    </span>
                    <span className="badge badge-synthetic font-mono text-[10px]">
                      {item.scenario}
                    </span>
                    <span className="badge badge-synthetic font-mono text-[10px]">
                      {item.client}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-600 font-sans line-clamp-1">
                    {item.summary}
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span
                    className={`badge font-mono text-[10px] ${
                      item.outcome === 'VERIFIED'
                        ? 'badge-emerald'
                        : item.outcome === 'BLOCKED'
                        ? 'badge-rose'
                        : item.outcome === 'ESCALATED'
                        ? 'badge-amber'
                        : item.outcome === 'PENDING_APPROVAL'
                        ? 'badge-amber'
                        : 'badge-cyan'
                    }`}
                  >
                    {item.outcome}
                  </span>
                  <span className="font-mono text-[10px] text-zinc-400">
                    {new Date(item.created_at).toLocaleString()}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
