import React, { useState, useMemo } from 'react';
import {
  History,
  RefreshCw,
  Search,
  Filter,
  Clock,
  ArrowRight,
  Copy,
  Check,
  Compass,
  AlertTriangle,
} from 'lucide-react';
import { IncidentSummaryItem } from '../types';

interface IncidentsViewProps {
  incidents: IncidentSummaryItem[];
  isLoading: boolean;
  error?: string | null;
  selectedIncidentId: string | null;
  onSelectIncident: (incidentId: string) => void;
  onRefresh: () => void;
  onNavigateToView?: (view: 'operations' | 'investigations' | 'approvals') => void;
}

export const IncidentsView: React.FC<IncidentsViewProps> = ({
  incidents,
  isLoading,
  error,
  selectedIncidentId,
  onSelectIncident,
  onRefresh,
  onNavigateToView,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [scenarioFilter, setScenarioFilter] = useState<string>('ALL');
  const [clientFilter, setClientFilter] = useState<string>('ALL');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyIncidentId = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const uniqueScenarios = useMemo(() => {
    const set = new Set<string>();
    incidents.forEach((i) => i.scenario && set.add(i.scenario));
    return Array.from(set).sort();
  }, [incidents]);

  const uniqueClients = useMemo(() => {
    const set = new Set<string>();
    incidents.forEach((i) => i.client && set.add(i.client));
    return Array.from(set).sort();
  }, [incidents]);

  const filteredIncidents = useMemo(() => {
    const list = incidents.filter((item) => {
      // Status filter
      if (statusFilter !== 'ALL' && item.outcome !== statusFilter) {
        return false;
      }

      // Scenario filter
      if (scenarioFilter !== 'ALL' && item.scenario !== scenarioFilter) {
        return false;
      }

      // Client filter
      if (clientFilter !== 'ALL' && item.client !== clientFilter) {
        return false;
      }

      // Search query filter
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        item.incident_id.toLowerCase().includes(q) ||
        (item.scenario && item.scenario.toLowerCase().includes(q)) ||
        (item.client && item.client.toLowerCase().includes(q)) ||
        (item.summary && item.summary.toLowerCase().includes(q))
      );
    });

    list.sort((a, b) => {
      const timeA = new Date(a.created_at || 0).getTime();
      const timeB = new Date(b.created_at || 0).getTime();
      return sortOrder === 'desc' ? timeB - timeA : timeA - timeB;
    });

    return list;
  }, [incidents, statusFilter, scenarioFilter, clientFilter, searchQuery, sortOrder]);

  const paginatedIncidents = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredIncidents.slice(start, start + pageSize);
  }, [filteredIncidents, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredIncidents.length / pageSize) || 1;

  const statusOptions = ['ALL', 'VERIFIED', 'PENDING_APPROVAL', 'RUNNING', 'ESCALATED', 'BLOCKED', 'UNVERIFIED'];

  return (
    <div className="w-full flex flex-col gap-6" data-testid="incidents-view">
      {/* Header and Controls */}
      <div className="panel border-l-4 border-l-[#0E7490] flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-[#DFD7C7] pb-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#1C1917] text-[#FAF6F0] flex items-center justify-center font-mono">
              <History className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-mono font-bold uppercase tracking-wider text-[#1C1917]">
                  PERSISTED INCIDENT EXPLORER
                </h1>
                <span className="badge badge-synthetic font-mono text-[10px]">
                  {incidents.length} TOTAL STORED
                </span>
              </div>
              <p className="text-xs text-[#6B6255] font-sans mt-0.5">
                Audit history of autonomous investigations, safety gates, and independent recovery verifications.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              className="btn btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 font-mono"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>REFRESH LOG</span>
            </button>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#827869]" />
            <input
              type="text"
              placeholder="Search by ID, scenario, client, or summary..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 text-xs font-mono"
            />
          </div>

          {/* Status Filter Buttons */}
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[11px] font-mono text-[#6B6255] uppercase tracking-wider mr-1 flex items-center gap-1">
              <Filter className="w-3 h-3" /> Status:
            </span>
            {statusOptions.map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-2 py-1 text-[10px] font-mono font-bold uppercase transition-colors ${
                  statusFilter === st
                    ? 'bg-[#1C1917] text-[#FAF6F0]'
                    : 'bg-[#ECE6DC] text-[#6B6255] hover:text-[#1C1917]'
                }`}
              >
                {st.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        {/* Advanced Filters: Scenario, Client, Sorting & Page Sizing */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#DFD7C7] text-xs font-mono">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-[#6B6255] uppercase text-[11px]">Scenario:</span>
              <select
                value={scenarioFilter}
                onChange={(e) => {
                  setScenarioFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="px-2 py-1 bg-[#ECE6DC] border border-[#DFD7C7] text-xs font-mono text-[#1C1917] focus:outline-none"
                aria-label="Filter incidents by scenario"
              >
                <option value="ALL">ALL SCENARIOS</option>
                {uniqueScenarios.map((sc) => (
                  <option key={sc} value={sc}>
                    {sc}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[#6B6255] uppercase text-[11px]">Client:</span>
              <select
                value={clientFilter}
                onChange={(e) => {
                  setClientFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="px-2 py-1 bg-[#ECE6DC] border border-[#DFD7C7] text-xs font-mono text-[#1C1917] focus:outline-none"
                aria-label="Filter incidents by client"
              >
                <option value="ALL">ALL CLIENTS</option>
                {uniqueClients.map((cl) => (
                  <option key={cl} value={cl}>
                    {cl}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[#6B6255] uppercase text-[11px]">Sort:</span>
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as 'desc' | 'asc')}
                className="px-2 py-1 bg-[#ECE6DC] border border-[#DFD7C7] text-xs font-mono text-[#1C1917] focus:outline-none"
                aria-label="Sort incidents"
              >
                <option value="desc">NEWEST FIRST</option>
                <option value="asc">OLDEST FIRST</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-[#6B6255]">
            <span>Showing {paginatedIncidents.length} of {filteredIncidents.length}</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="px-2 py-1 bg-[#ECE6DC] border border-[#DFD7C7] text-xs font-mono text-[#1C1917] focus:outline-none"
              aria-label="Page size"
            >
              <option value={10}>10 per page</option>
              <option value={25}>25 per page</option>
              <option value={50}>50 per page</option>
              <option value={100}>100 per page</option>
            </select>
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="panel p-6 border-red-300 bg-red-50/40 text-center flex flex-col items-center gap-2">
          <AlertTriangle className="w-6 h-6 text-red-600" />
          <div className="text-xs font-mono font-bold uppercase text-red-900">
            Failed to load incident history
          </div>
          <div className="text-xs font-mono text-red-700">{error}</div>
          <button
            type="button"
            onClick={onRefresh}
            className="btn btn-secondary text-xs mt-1"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="panel p-10 flex flex-col items-center justify-center text-center gap-2">
          <RefreshCw className="w-6 h-6 text-[#0E7490] animate-spin" />
          <div className="font-mono text-xs font-bold uppercase tracking-wider text-[#1C1917]">
            LOADING INCIDENT HISTORY...
          </div>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && filteredIncidents.length === 0 && (
        <div className="panel p-10 flex flex-col items-center justify-center text-center gap-2">
          <History className="w-8 h-8 text-[#827869]" />
          <div className="font-mono text-xs font-bold uppercase tracking-wider text-[#1C1917]">
            NO MATCHING INCIDENTS FOUND
          </div>
          <p className="text-xs text-[#827869] max-w-sm">
            {searchQuery || statusFilter !== 'ALL'
              ? 'Try resetting the search terms or status filter to see historical records.'
              : 'Launch a fault scenario in Live Operations to begin generating persistent incident logs.'}
          </p>
        </div>
      )}

      {/* Incident List */}
      {!isLoading && !error && filteredIncidents.length > 0 && (
        <div className="flex flex-col gap-3">
          {paginatedIncidents.map((item) => {
            const isSelected = item.incident_id === selectedIncidentId;

            return (
              <div
                key={item.incident_id}
                onClick={() => onSelectIncident(item.incident_id)}
                className={`panel transition-all cursor-pointer p-4 ${
                  isSelected
                    ? 'border-[#0E7490] bg-[#FCFAF6] ring-1 ring-[#0E7490]'
                    : 'border-[#DFD7C7] hover:border-[#827869] hover:bg-[#FAF6F0]'
                }`}
                data-testid={`incident-card-${item.incident_id}`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#DFD7C7] pb-2 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold text-[#1C1917] flex items-center gap-1">
                      <span>{item.incident_id}</span>
                      <button
                        type="button"
                        onClick={(e) => copyIncidentId(item.incident_id, e)}
                        className="text-[#827869] hover:text-[#1C1917] p-0.5"
                        title="Copy Incident ID"
                      >
                        {copiedId === item.incident_id ? (
                          <Check className="w-3 h-3 text-emerald-600" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </span>

                    <span className="badge badge-synthetic font-mono text-[10px]">
                      Scenario: {item.scenario}
                    </span>

                    <span className="badge badge-synthetic font-mono text-[10px]">
                      Client: {item.client}
                    </span>

                    <span className="badge badge-synthetic font-mono text-[10px]">
                      Mode: {item.mode}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {isSelected && (
                      <span className="badge badge-cyan font-mono text-[10px]">
                        ACTIVE IN COCKPIT
                      </span>
                    )}
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
                  </div>
                </div>

                <div className="text-xs text-[#575044] font-sans leading-relaxed mb-3">
                  {item.summary}
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-[#DFD7C7] text-[11px] font-mono text-[#827869]">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Created: {item.created_at ? new Date(item.created_at).toLocaleString() : 'N/A'}
                    </span>
                    {item.updated_at && item.updated_at !== item.created_at && (
                      <span>Updated: {new Date(item.updated_at).toLocaleTimeString()}</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {isSelected && onNavigateToView && (
                      <>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onNavigateToView('operations');
                          }}
                          className="btn btn-secondary text-[10px] py-1 px-2 font-mono flex items-center gap-1"
                        >
                          <span>Live Ops</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onNavigateToView('investigations');
                          }}
                          className="btn btn-secondary text-[10px] py-1 px-2 font-mono flex items-center gap-1"
                        >
                          <Compass className="w-3 h-3" />
                          <span>Investigation</span>
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => onSelectIncident(item.incident_id)}
                      className={`text-xs font-mono font-bold uppercase flex items-center gap-1 ${
                        isSelected ? 'text-[#0E7490]' : 'text-[#6B6255] hover:text-[#1C1917]'
                      }`}
                    >
                      <span>{isSelected ? 'LOADED' : 'INSPECT'}</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Controls */}
      {!isLoading && !error && filteredIncidents.length > 0 && totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-[#DFD7C7] pt-3 font-mono text-xs">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            className="btn btn-secondary text-xs py-1 px-3 disabled:opacity-40"
          >
            &larr; PREVIOUS
          </button>
          <span className="text-[#6B6255]">
            PAGE <strong className="text-[#1C1917]">{currentPage}</strong> OF <strong className="text-[#1C1917]">{totalPages}</strong>
          </span>
          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            className="btn btn-secondary text-xs py-1 px-3 disabled:opacity-40"
          >
            NEXT &rarr;
          </button>
        </div>
      )}
    </div>
  );
};
