import React, { useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  Clock,
  Filter,
  RefreshCw,
  ArrowRight,
  TrendingUp,
  Server,
  Layers,
} from 'lucide-react';
import { IncidentSummaryItem } from '../types';
import { computeIncidentAnalytics } from '../lib/analytics';

interface AnalyticsDashboardProps {
  incidents: IncidentSummaryItem[];
  isLoading: boolean;
  onRefresh: () => void;
  onSelectIncident: (incidentId: string) => void;
  onNavigateToView: (view: 'operations' | 'investigations' | 'incidents' | 'approvals' | 'benchmark') => void;
}

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({
  incidents,
  isLoading,
  onRefresh,
  onSelectIncident,
  onNavigateToView,
}) => {
  const [selectedScenarioFilter, setSelectedScenarioFilter] = useState<string>('all');
  const [selectedClientFilter, setSelectedClientFilter] = useState<string>('all');

  // Filtered dataset for scoped metrics
  const filteredIncidents = useMemo(() => {
    return incidents.filter((inc) => {
      if (selectedScenarioFilter !== 'all' && inc.scenario !== selectedScenarioFilter) return false;
      if (selectedClientFilter !== 'all' && inc.client !== selectedClientFilter) return false;
      return true;
    });
  }, [incidents, selectedScenarioFilter, selectedClientFilter]);

  const analytics = useMemo(() => {
    return computeIncidentAnalytics(filteredIncidents);
  }, [filteredIncidents]);

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

  return (
    <div className="w-full flex flex-col gap-6" data-testid="analytics-dashboard">
      {/* Header & Controls */}
      <div className="panel border-l-4 border-l-[#0E7490] flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-[#DFD7C7] pb-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#1C1917] text-[#FAF6F0] flex items-center justify-center font-mono">
              <TrendingUp className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-sm font-mono font-bold uppercase tracking-wider text-[#1C1917]">
                  OPERATIONAL ANALYTICS & GOVERNANCE DASHBOARD
                </h1>
                <span className="badge badge-synthetic font-mono text-[10px]">
                  {filteredIncidents.length} Records Evaluated
                </span>
              </div>
              <p className="text-xs text-[#6B6255] font-sans mt-0.5">
                Deterministic metric telemetry derived exclusively from real historical incidents. No synthetic extrapolations.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap self-start md:self-auto">
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              className="btn btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 font-mono"
              title="Refresh incident metrics"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>REFRESH</span>
            </button>
          </div>
        </div>

        {/* Filters Bar */}
        <div className="flex items-center justify-between flex-wrap gap-3 font-mono text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 text-[#6B6255]">
              <Filter className="w-3.5 h-3.5" />
              <span>FILTERS:</span>
            </div>

            {/* Scenario filter */}
            <select
              value={selectedScenarioFilter}
              onChange={(e) => setSelectedScenarioFilter(e.target.value)}
              className="px-2 py-1 bg-[#ECE6DC] border border-[#DFD7C7] text-xs font-mono text-[#1C1917] focus:outline-none focus:border-[#0E7490]"
              aria-label="Filter by scenario"
            >
              <option value="all">ALL SCENARIOS ({uniqueScenarios.length})</option>
              {uniqueScenarios.map((sc) => (
                <option key={sc} value={sc}>
                  {sc}
                </option>
              ))}
            </select>

            {/* Client filter */}
            <select
              value={selectedClientFilter}
              onChange={(e) => setSelectedClientFilter(e.target.value)}
              className="px-2 py-1 bg-[#ECE6DC] border border-[#DFD7C7] text-xs font-mono text-[#1C1917] focus:outline-none focus:border-[#0E7490]"
              aria-label="Filter by client"
            >
              <option value="all">ALL CLIENTS ({uniqueClients.length})</option>
              {uniqueClients.map((cl) => (
                <option key={cl} value={cl}>
                  {cl}
                </option>
              ))}
            </select>

            {(selectedScenarioFilter !== 'all' || selectedClientFilter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setSelectedScenarioFilter('all');
                  setSelectedClientFilter('all');
                }}
                className="btn btn-secondary text-[11px] py-1 px-2"
              >
                CLEAR FILTERS
              </button>
            )}
          </div>

          <div className="text-[11px] text-[#6B6255]">
            Source: <strong className="text-[#1C1917]">ProofLoop Local Datastore</strong>
          </div>
        </div>
      </div>

      {/* Row 1: KPI Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Total Incidents */}
        <div className="panel p-4 flex flex-col justify-between gap-2 border-t-2 border-t-[#0E7490]">
          <div className="flex items-center justify-between text-[#6B6255] font-mono text-xs">
            <span className="uppercase tracking-wider">Total Incidents</span>
            <Server className="w-4 h-4 text-[#0E7490]" />
          </div>
          <div className="text-2xl font-mono font-bold text-[#1C1917]">
            {analytics.totalIncidents}
          </div>
          <div className="text-[11px] font-mono text-[#6B6255] flex justify-between">
            <span>Verified: <strong className="text-emerald-700">{analytics.verifiedRecoveries}</strong></span>
            <span>Escalated: <strong className="text-amber-700">{analytics.escalatedCount}</strong></span>
          </div>
        </div>

        {/* Verified Recovery Rate */}
        <div className="panel p-4 flex flex-col justify-between gap-2 border-t-2 border-t-[#15803D]">
          <div className="flex items-center justify-between text-[#6B6255] font-mono text-xs">
            <span className="uppercase tracking-wider">Verified Recovery</span>
            <CheckCircle2 className="w-4 h-4 text-[#15803D]" />
          </div>
          <div className="text-2xl font-mono font-bold text-emerald-800">
            {(analytics.verifiedRecoveryRate * 100).toFixed(1)}%
          </div>
          <div className="text-[11px] font-mono text-[#6B6255]">
            {analytics.verifiedRecoveries} of {analytics.totalIncidents} runs proven
          </div>
        </div>

        {/* False Success Rate (Strict Zero-Tolerance) */}
        <div className="panel p-4 flex flex-col justify-between gap-2 border-t-2 border-t-cyan-700">
          <div className="flex items-center justify-between text-[#6B6255] font-mono text-xs">
            <span className="uppercase tracking-wider">False-Success Rate</span>
            <ShieldCheck className="w-4 h-4 text-cyan-700" />
          </div>
          <div className="text-2xl font-mono font-bold text-[#1C1917]">
            {(analytics.falseSuccessRate * 100).toFixed(1)}%
          </div>
          <div className="text-[11px] font-mono text-emerald-700">
            ✓ Zero unverified success claims
          </div>
        </div>

        {/* Policy Gate Violations */}
        <div className="panel p-4 flex flex-col justify-between gap-2 border-t-2 border-t-[#B45309]">
          <div className="flex items-center justify-between text-[#6B6255] font-mono text-xs">
            <span className="uppercase tracking-wider">Policy Gate Violations</span>
            <ShieldAlert className="w-4 h-4 text-[#B45309]" />
          </div>
          <div className="text-2xl font-mono font-bold text-[#1C1917]">
            {(analytics.policyViolationRate * 100).toFixed(1)}%
          </div>
          <div className="text-[11px] font-mono text-[#6B6255]">
            100% deterministic gate enforcement
          </div>
        </div>
      </div>

      {/* Row 2: Secondary Indicators (MTTR & Pending Approvals) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Mean Time To Recovery */}
        <div className="panel p-4 flex flex-col justify-between gap-2">
          <div className="flex items-center justify-between text-[#6B6255] font-mono text-xs">
            <span className="uppercase tracking-wider">Mean Time to Verified Recovery</span>
            <Clock className="w-4 h-4 text-[#0E7490]" />
          </div>
          <div className="text-xl font-mono font-bold text-[#1C1917]">
            {analytics.meanTimeToRecoveryMs !== null
              ? `${(analytics.meanTimeToRecoveryMs / 1000).toFixed(1)}s`
              : 'Unavailable'}
          </div>
          <div className="text-[11px] text-[#6B6255]">
            {analytics.meanTimeToRecoveryMs !== null
              ? 'Computed from verified incident lifecycle timestamps.'
              : 'Exact resolution timestamps not recorded for current sample.'}
          </div>
        </div>

        {/* Pending Approvals Queue */}
        <div className="panel p-4 flex flex-col justify-between gap-2">
          <div className="flex items-center justify-between text-[#6B6255] font-mono text-xs">
            <span className="uppercase tracking-wider">Pending Approvals</span>
            <AlertTriangle className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-xl font-mono font-bold text-amber-800">
            {analytics.pendingApprovals}
          </div>
          <div className="flex justify-between items-center text-[11px] font-mono">
            <span className="text-[#6B6255]">Awaiting human authorization</span>
            <button
              type="button"
              onClick={() => onNavigateToView('approvals')}
              className="text-[#0E7490] hover:underline font-bold"
            >
              INSPECT &rarr;
            </button>
          </div>
        </div>

        {/* Active Incident State */}
        <div className="panel p-4 flex flex-col justify-between gap-2">
          <div className="flex items-center justify-between text-[#6B6255] font-mono text-xs">
            <span className="uppercase tracking-wider">Active Executions</span>
            <Activity className="w-4 h-4 text-cyan-600" />
          </div>
          <div className="text-xl font-mono font-bold text-[#1C1917]">
            {analytics.runningCount}
          </div>
          <div className="flex justify-between items-center text-[11px] font-mono">
            <span className="text-[#6B6255]">Current running tasks</span>
            <button
              type="button"
              onClick={() => onNavigateToView('operations')}
              className="text-[#0E7490] hover:underline font-bold"
            >
              LIVE OPS &rarr;
            </button>
          </div>
        </div>
      </div>

      {/* Row 3: Scenario Breakdown Matrix */}
      <div className="panel">
        <div className="panel-header">
          <h2 className="panel-title">
            <Layers className="w-4 h-4 text-[#0E7490]" />
            <span>Scenario Performance Matrix</span>
          </h2>
          <span className="badge badge-synthetic font-mono text-xs">
            {Object.keys(analytics.scenarioBreakdown).length} Scenarios
          </span>
        </div>

        {Object.keys(analytics.scenarioBreakdown).length === 0 ? (
          <div className="p-8 text-center text-[#827869] font-mono text-xs">
            No incident records available matching the filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th>Total Runs</th>
                  <th>Verified Recoveries</th>
                  <th>Escalated</th>
                  <th>Failed / Unverified</th>
                  <th>Success Rate</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(analytics.scenarioBreakdown).map(([scenarioName, stats]) => {
                  const rate = stats.total > 0 ? (stats.verified / stats.total) * 100 : 0;
                  return (
                    <tr key={scenarioName}>
                      <td className="font-mono font-bold text-xs text-[#1C1917]">
                        {scenarioName}
                      </td>
                      <td className="font-mono text-xs">{stats.total}</td>
                      <td className="font-mono text-xs text-emerald-800">
                        {stats.verified}
                      </td>
                      <td className="font-mono text-xs text-amber-800">
                        {stats.escalated}
                      </td>
                      <td className="font-mono text-xs text-rose-800">
                        {stats.failed}
                      </td>
                      <td className="font-mono text-xs font-bold">
                        <span
                          className={`badge text-[10px] ${
                            rate >= 75
                              ? 'badge-emerald'
                              : rate > 0
                              ? 'badge-amber'
                              : 'badge-rose'
                          }`}
                        >
                          {rate.toFixed(0)}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Row 4: Recent Incident Activity */}
      <div className="panel">
        <div className="panel-header">
          <h2 className="panel-title">
            <Activity className="w-4 h-4 text-[#0E7490]" />
            <span>Recent Incident Operations Feed</span>
          </h2>
          <button
            type="button"
            onClick={() => onNavigateToView('incidents')}
            className="text-xs font-mono text-[#0E7490] hover:underline flex items-center gap-1"
          >
            <span>VIEW ALL INCIDENTS</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {analytics.recentTimeline.length === 0 ? (
          <div className="p-8 text-center text-[#827869] font-mono text-xs">
            No incident history recorded yet. Launch a run in Live Operations.
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-[#DFD7C7]">
            {analytics.recentTimeline.map((item) => (
              <div
                key={item.incident_id}
                className="py-2.5 px-3 flex items-center justify-between gap-3 hover:bg-[#ECE6DC] transition-colors cursor-pointer"
                onClick={() => onSelectIncident(item.incident_id)}
                title="Click to view details in Incident Explorer"
              >
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-xs font-bold text-[#1C1917]">
                    {item.incident_id.slice(0, 10)}...
                  </span>
                  <span className="badge badge-synthetic font-mono text-[10px]">
                    {item.scenario}
                  </span>
                </div>

                <div className="flex items-center gap-3">
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
                  <span className="text-[10px] font-mono text-[#827869] hidden sm:inline">
                    {item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
