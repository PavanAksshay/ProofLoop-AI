import React, { useState } from 'react';
import {
  Compass,
  AlertTriangle,
  HelpCircle,
  RefreshCw,
  Cpu,
  FileText,
  ChevronDown,
  ChevronRight,
  Layers,
  Activity,
  RotateCcw,
  Shield,
  Network,
} from 'lucide-react';
import { ServiceTopologyExplorer } from './ServiceTopologyExplorer';
import {
  EvidenceItem,
  InvestigationState,
  IncidentResponse,
} from '../types';

interface InvestigationViewProps {
  activeIncident: IncidentResponse | null;
  investigation: InvestigationState | null;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelectIncident?: (incidentId: string) => void;
  allIncidents?: Array<{ incident_id: string; scenario: string; client: string; outcome: string }>;
}

export const InvestigationView: React.FC<InvestigationViewProps> = ({
  activeIncident,
  investigation,
  isLoading,
  error,
  onRetry,
  onSelectIncident,
  allIncidents = [],
}) => {
  const [selectedHypothesisId, setSelectedHypothesisId] = useState<string | null>(null);
  const [expandedEvidenceId, setExpandedEvidenceId] = useState<string | null>(null);
  const [expandedDiagnosticIdx, setExpandedDiagnosticIdx] = useState<number | null>(null);
  const [expandedRemediationIdx, setExpandedRemediationIdx] = useState<number | null>(null);
  const [evidenceFilter, setEvidenceFilter] = useState<'all' | 'direct_observation' | 'diagnostic_result' | 'contradictory'>('all');
  const [investigationSubView, setInvestigationSubView] = useState<'matrix' | 'topology'>('matrix');

  // No incident selected state
  if (!activeIncident && !investigation) {
    return (
      <div className="panel p-10 flex flex-col items-center justify-center text-center gap-4 my-8" data-testid="investigation-no-incident">
        <div className="w-14 h-14 bg-[#ECE6DC] border border-[#DFD7C7] flex items-center justify-center">
          <Compass className="w-7 h-7 text-[#0E7490]" />
        </div>
        <div className="max-w-md">
          <h2 className="text-base font-mono font-bold uppercase tracking-wider text-[#1C1917]">
            NO ACTIVE INCIDENT SELECTED
          </h2>
          <p className="text-xs text-[#827869] mt-1 leading-relaxed">
            Select an incident from the history log or start a new fault scenario in Live Operations to inspect hypothesis matrices, correlated evidence, and diagnostic budgets.
          </p>
        </div>
        {allIncidents.length > 0 && onSelectIncident && (
          <div className="w-full max-w-sm mt-3 pt-3 border-t border-[#DFD7C7]">
            <label className="text-[11px] font-mono text-[#575044] uppercase tracking-wider block mb-1 text-left">
              Quick Select Recent Incident:
            </label>
            <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
              {allIncidents.slice(0, 5).map((inc) => (
                <button
                  key={inc.incident_id}
                  type="button"
                  onClick={() => onSelectIncident(inc.incident_id)}
                  className="btn btn-secondary text-xs p-2 text-left flex justify-between items-center"
                >
                  <span className="font-mono text-xs">{inc.incident_id.slice(0, 10)}...</span>
                  <span className="badge badge-synthetic font-mono text-[10px]">{inc.scenario}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Request error state
  if (error) {
    return (
      <div className="panel p-8 flex flex-col items-center justify-center text-center gap-3 my-8 border-red-300 bg-red-50/40" data-testid="investigation-error">
        <AlertTriangle className="w-8 h-8 text-red-600" />
        <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-red-900">
          FAILED TO LOAD INVESTIGATION STATE
        </h2>
        <p className="text-xs text-red-700 max-w-md font-mono">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="btn btn-secondary text-xs mt-2 flex items-center gap-2 font-mono"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>RETRY REQUEST</span>
        </button>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="panel p-12 flex flex-col items-center justify-center text-center gap-3 my-8" data-testid="investigation-loading">
        <RefreshCw className="w-8 h-8 text-[#0E7490] animate-spin" />
        <div className="font-mono text-xs font-bold uppercase tracking-wider text-[#1C1917]">
          FETCHING AUTONOMOUS INVESTIGATION STATE...
        </div>
        <div className="text-xs text-[#827869] font-mono">
          Correlating hypotheses, diagnostic telemetry, and evidence graph...
        </div>
      </div>
    );
  }

  // Empty investigation state (incident exists, but no investigation recorded)
  if (!investigation) {
    return (
      <div className="panel p-10 flex flex-col items-center justify-center text-center gap-3 my-8" data-testid="investigation-empty">
        <FileText className="w-8 h-8 text-[#827869]" />
        <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-[#1C1917]">
          NO INVESTIGATION STATE FOR THIS INCIDENT
        </h2>
        <p className="text-xs text-[#827869] max-w-md leading-relaxed">
          The selected incident ({activeIncident?.incident_id.slice(0, 8)}...) did not generate or store autonomous hypothesis investigation state.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="btn btn-secondary text-xs mt-2 flex items-center gap-2 font-mono"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>RECHECK ENDPOINT</span>
        </button>
      </div>
    );
  }

  const {
    incident_id,
    hypotheses = [],
    evidence = [],
    diagnostics_performed = [],
    remediation_history = [],
    budget,
    current_diagnosis,
    symptoms = [],
    outstanding_uncertainties = [],
    step = 0,
    replanning_cycle = 0,
    termination_reason,
    escalation_reason,
    last_evaluation_summary,
  } = investigation;

  const evidenceMap = new Map<string, EvidenceItem>();
  evidence.forEach((ev) => evidenceMap.set(ev.id, ev));

  const selectedHypothesis = hypotheses.find((h) => h.id === selectedHypothesisId) || hypotheses[0];

  const filteredEvidence = evidence.filter((ev) => {
    if (evidenceFilter === 'all') return true;
    return ev.kind === evidenceFilter;
  });

  return (
    <div className="w-full flex flex-col gap-6" data-testid="investigation-view">
      {/* Header Banner: Identity, Status & Budget Overview */}
      <div className="panel border-l-4 border-l-[#0E7490] flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-[#DFD7C7] pb-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#1C1917] text-[#FAF6F0] flex items-center justify-center font-mono">
              <Compass className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-sm font-mono font-bold uppercase tracking-wider text-[#1C1917]">
                  AUTONOMOUS INVESTIGATION COCKPIT
                </h1>
                <span className="badge badge-synthetic font-mono text-[10px]">
                  ID: {incident_id.slice(0, 8)}...
                </span>
                {activeIncident?.scenario && (
                  <span className="badge badge-synthetic font-mono text-[10px]">
                    {activeIncident.scenario}
                  </span>
                )}
                {activeIncident?.outcome && (
                  <span
                    className={`badge font-mono text-[10px] ${
                      activeIncident.outcome === 'VERIFIED'
                        ? 'badge-emerald'
                        : activeIncident.outcome === 'BLOCKED'
                        ? 'badge-rose'
                        : activeIncident.outcome === 'ESCALATED'
                        ? 'badge-amber'
                        : activeIncident.outcome === 'PENDING_APPROVAL'
                        ? 'badge-amber'
                        : 'badge-cyan'
                    }`}
                  >
                    {activeIncident.outcome}
                  </span>
                )}
              </div>
              <p className="text-xs text-[#6B6255] font-sans mt-0.5">
                {activeIncident?.summary || 'Autonomous hypothesis exploration and evidence-driven diagnosis.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start md:self-auto">
            <button
              type="button"
              onClick={onRetry}
              disabled={isLoading}
              className="btn btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 font-mono"
              title="Refresh investigation state from backend"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>REFRESH</span>
            </button>
          </div>
        </div>

        {/* Diagnostic and Tool Budget Indicators */}
        {budget && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono text-xs">
            <div className="bg-[#ECE6DC] p-2.5 border border-[#DFD7C7]">
              <span className="text-[10px] uppercase tracking-wider text-[#6B6255] block">
                Investigation Steps
              </span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <strong className="text-sm text-[#1C1917]">{budget.steps_taken ?? step}</strong>
                <span className="text-[#827869]">/ {budget.max_steps} max</span>
              </div>
              <div className="text-[10px] text-[#827869] mt-0.5">
                Remaining: {Math.max(0, (budget.max_steps || 0) - (budget.steps_taken ?? step))}
              </div>
            </div>

            <div className="bg-[#ECE6DC] p-2.5 border border-[#DFD7C7]">
              <span className="text-[10px] uppercase tracking-wider text-[#6B6255] block">
                Diagnostics Run
              </span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <strong className="text-sm text-[#0E7490]">{budget.diagnostics_run}</strong>
                <span className="text-[#827869]">/ {budget.max_diagnostics} max</span>
              </div>
              <div className="text-[10px] text-[#827869] mt-0.5">
                Remaining: {Math.max(0, (budget.max_diagnostics || 0) - (budget.diagnostics_run || 0))}
              </div>
            </div>

            <div className="bg-[#ECE6DC] p-2.5 border border-[#DFD7C7]">
              <span className="text-[10px] uppercase tracking-wider text-[#6B6255] block">
                Remediations Attempted
              </span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <strong className="text-sm text-[#1C1917]">{budget.remediations_attempted}</strong>
                <span className="text-[#827869]">/ {budget.max_remediations} max</span>
              </div>
              <div className="text-[10px] text-[#827869] mt-0.5">
                Remaining: {Math.max(0, (budget.max_remediations || 0) - (budget.remediations_attempted || 0))}
              </div>
            </div>

            <div className="bg-[#ECE6DC] p-2.5 border border-[#DFD7C7]">
              <span className="text-[10px] uppercase tracking-wider text-[#6B6255] block">
                Replanning Cycles
              </span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <strong className="text-sm text-[#B45309]">{replanning_cycle}</strong>
                <span className="text-[#827869]">cycles</span>
              </div>
              <div className="text-[10px] text-[#827869] mt-0.5">
                Pending Approval: {budget.remediations_pending_approval ?? 0}
              </div>
            </div>
          </div>
        )}

        {/* Escalation or Termination Notice */}
        {(termination_reason || escalation_reason) && (
          <div className="p-3 bg-[#F7EEDC] border border-[#E6CE9F] text-xs font-mono text-[#78350F] flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 text-[#B45309]" />
            <div>
              <strong>TERMINATION REASON:</strong>{' '}
              {termination_reason || escalation_reason}
            </div>
          </div>
        )}
      </div>

      {/* Subview Toggle: Hypothesis & Ledger Cockpit vs Service Topology Explorer */}
      <div className="flex items-center justify-between border-b border-[#DFD7C7] pb-2 flex-wrap gap-2">
        <div className="flex items-center border border-[#DFD7C7] divide-x divide-[#DFD7C7] bg-[#ECE6DC]" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={investigationSubView === 'matrix'}
            onClick={() => setInvestigationSubView('matrix')}
            className={`px-3 py-1.5 text-xs font-mono font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors ${
              investigationSubView === 'matrix'
                ? 'bg-[#1C1917] text-[#FAF6F0]'
                : 'bg-transparent text-[#6B6255] hover:text-[#1C1917]'
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            <span>01 HYPOTHESIS & LEDGER COCKPIT</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={investigationSubView === 'topology'}
            onClick={() => setInvestigationSubView('topology')}
            className={`px-3 py-1.5 text-xs font-mono font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors ${
              investigationSubView === 'topology'
                ? 'bg-[#1C1917] text-[#FAF6F0]'
                : 'bg-transparent text-[#6B6255] hover:text-[#1C1917]'
            }`}
          >
            <Network className="w-3.5 h-3.5" />
            <span>02 SERVICE TOPOLOGY & DEPENDENCIES</span>
          </button>
        </div>

        <span className="badge badge-synthetic font-mono text-[10px]">
          {investigationSubView === 'matrix' ? 'VIEW: EVIDENCE MATRIX' : 'VIEW: SYNTHESIZED TOPOLOGY'}
        </span>
      </div>

      {investigationSubView === 'topology' ? (
        <ServiceTopologyExplorer
          investigation={investigation}
          incidentId={incident_id}
          scenario={activeIncident?.scenario}
          onSelectEvidence={(evId) => {
            setInvestigationSubView('matrix');
            setExpandedEvidenceId(evId);
          }}
        />
      ) : (
        <>
      {/* Row 1: Current Diagnosis & Symptoms */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Leading Diagnosis Card */}
        <div className="panel lg:col-span-2">
          <div className="panel-header">
            <h2 className="panel-title">
              <Cpu className="w-4 h-4 text-[#0E7490]" />
              <span>Current Leading Diagnosis</span>
            </h2>
            {current_diagnosis?.confidence !== undefined && (
              <span className="badge badge-emerald font-mono text-xs">
                {(current_diagnosis.confidence * 100).toFixed(0)}% Confidence
              </span>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <div className="bg-[#ECE6DC] p-4 border border-[#DFD7C7]">
              <div className="text-xs font-mono uppercase text-[#6B6255] tracking-wider mb-1">
                Active Assessment
              </div>
              <div className="text-sm font-mono font-bold text-[#1C1917]">
                {current_diagnosis?.diagnosis || 'No definitive diagnosis formulated yet.'}
              </div>
              {current_diagnosis?.confidence_basis && (
                <div className="text-xs text-[#575044] font-sans mt-2 pt-2 border-t border-[#DFD7C7]">
                  <strong className="font-mono text-[#1C1917]">Basis:</strong> {current_diagnosis.confidence_basis}
                </div>
              )}
            </div>

            {last_evaluation_summary && (
              <div className="text-xs font-mono text-[#575044] bg-[#FAF6F0] p-3 border border-[#DFD7C7]">
                <strong className="text-[#1C1917]">Last Evaluation:</strong> {last_evaluation_summary}
              </div>
            )}
          </div>
        </div>

        {/* Symptoms & Outstanding Uncertainties */}
        <div className="panel flex flex-col gap-3">
          <div className="panel-header">
            <h2 className="panel-title">
              <HelpCircle className="w-4 h-4 text-[#B45309]" />
              <span>Symptoms & Questions</span>
            </h2>
            <span className="badge badge-synthetic font-mono text-[10px]">
              {symptoms.length} Symptoms
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <div>
              <span className="text-[11px] font-mono uppercase tracking-wider text-[#6B6255] block mb-1">
                Initial Symptoms Observed:
              </span>
              {symptoms.length === 0 ? (
                <div className="text-xs text-[#827869] italic">No symptoms registered</div>
              ) : (
                <ul className="flex flex-col gap-1">
                  {symptoms.map((symptom, idx) => (
                    <li key={idx} className="text-xs font-mono bg-[#ECE6DC] p-2 border border-[#DFD7C7] flex items-center gap-1.5">
                      <span className="text-[#0E7490] font-bold">&bull;</span>
                      <span>{symptom}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {outstanding_uncertainties.length > 0 && (
              <div className="pt-2 border-t border-[#DFD7C7]">
                <span className="text-[11px] font-mono uppercase tracking-wider text-[#B45309] block mb-1">
                  Unresolved Uncertainties:
                </span>
                <ul className="flex flex-col gap-1">
                  {outstanding_uncertainties.map((u, idx) => (
                    <li key={idx} className="text-xs font-sans text-[#78350F] bg-[#F7EEDC] p-2 border border-[#E6CE9F]">
                      ? {u}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Row 2: Competing Hypotheses Matrix */}
      <div className="panel">
        <div className="panel-header">
          <h2 className="panel-title">
            <Layers className="w-4 h-4 text-[#0E7490]" />
            <span>Competing Hypotheses Matrix</span>
          </h2>
          <span className="badge badge-synthetic font-mono text-xs">
            {hypotheses.length} {hypotheses.length === 1 ? 'Hypothesis' : 'Hypotheses'}
          </span>
        </div>

        {hypotheses.length === 0 ? (
          <div className="p-8 text-center text-[#827869] font-mono text-xs">
            No competing hypotheses registered for this investigation step.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {hypotheses.map((h) => {
              const isSelected = selectedHypothesis?.id === h.id;
              const hasConfidence = h.confidence_score !== undefined && h.confidence_score !== null;

              return (
                <div
                  key={h.id}
                  onClick={() => setSelectedHypothesisId(h.id)}
                  className={`p-3.5 border transition-all cursor-pointer flex flex-col justify-between ${
                    isSelected
                      ? 'border-[#0E7490] bg-[#E4F0F2] ring-1 ring-[#0E7490]'
                      : 'border-[#DFD7C7] bg-[#ECE6DC] hover:border-[#827869] hover:bg-[#E4DCCF]'
                  }`}
                  data-testid={`hypothesis-card-${h.id}`}
                >
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-1 flex-wrap">
                      <span className="font-mono text-xs font-bold text-[#1C1917]">
                        {h.id}
                      </span>
                      <div className="flex items-center gap-1">
                        <span
                          className={`badge font-mono text-[10px] ${
                            h.status === 'confirmed'
                              ? 'badge-emerald'
                              : h.status === 'refuted'
                              ? 'badge-rose'
                              : h.status === 'active'
                              ? 'badge-cyan'
                              : 'badge-synthetic'
                          }`}
                        >
                          {h.status}
                        </span>
                        {hasConfidence && (
                          <span className="badge badge-synthetic font-mono text-[10px]">
                            {((h.confidence_score as number) * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-xs font-mono font-bold text-[#1C1917]">
                      {h.title}
                    </div>

                    <div className="text-xs text-[#575044] font-sans line-clamp-2">
                      {h.description}
                    </div>
                  </div>

                  <div className="pt-2.5 mt-2 border-t border-[#DFD7C7] flex justify-between items-center text-[11px] font-mono">
                    <div className="flex items-center gap-2 text-[#575044]">
                      <span className="text-emerald-700" title="Supporting evidence count">
                        ✓ {h.supporting_evidence_ids.length}
                      </span>
                      <span className="text-rose-700" title="Contradicting evidence count">
                        ✕ {h.contradicting_evidence_ids.length}
                      </span>
                    </div>
                    <span className="text-[#0E7490] text-[10px] font-bold uppercase">
                      {isSelected ? 'ACTIVE DETAIL' : 'INSPECT'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Selected Hypothesis Detail Card */}
        {selectedHypothesis && (
          <div className="mt-4 p-4 border border-[#0E7490] bg-[#FCFAF6] flex flex-col gap-3">
            <div className="flex justify-between items-center border-b border-[#DFD7C7] pb-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-[#0E7490]">
                  HYPOTHESIS DETAIL: {selectedHypothesis.id}
                </span>
                <span className="badge badge-synthetic font-mono text-[10px]">
                  Category: {selectedHypothesis.category || 'general'}
                </span>
              </div>
              {selectedHypothesis.confidence_score !== undefined && (
                <span className="badge badge-cyan font-mono text-xs">
                  Confidence: {(selectedHypothesis.confidence_score * 100).toFixed(0)}%
                </span>
              )}
            </div>

            <div className="text-xs font-sans text-[#1C1917]">
              {selectedHypothesis.description}
            </div>

            {selectedHypothesis.last_ranking_change_reason && (
              <div className="text-xs font-mono bg-[#ECE6DC] p-2 border border-[#DFD7C7] text-[#575044]">
                <strong className="text-[#1C1917]">Ranking Rationale:</strong>{' '}
                {selectedHypothesis.last_ranking_change_reason}
              </div>
            )}

            {/* Evidence Links */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
              <div className="bg-[#E7F0E5] p-3 border border-[#BCD5B8]">
                <span className="font-mono text-xs font-bold text-emerald-900 block mb-1">
                  Supporting Evidence ({selectedHypothesis.supporting_evidence_ids.length}):
                </span>
                {selectedHypothesis.supporting_evidence_ids.length === 0 ? (
                  <span className="text-xs text-emerald-700 italic">None linked</span>
                ) : (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {selectedHypothesis.supporting_evidence_ids.map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setExpandedEvidenceId(id)}
                        className="badge badge-emerald font-mono text-[10px] cursor-pointer hover:bg-emerald-200"
                        title={evidenceMap.get(id)?.summary || id}
                      >
                        ✓ {id}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-[#F8E7E7] p-3 border border-[#E8B8B8]">
                <span className="font-mono text-xs font-bold text-rose-900 block mb-1">
                  Contradicting Evidence ({selectedHypothesis.contradicting_evidence_ids.length}):
                </span>
                {selectedHypothesis.contradicting_evidence_ids.length === 0 ? (
                  <span className="text-xs text-rose-700 italic">None linked</span>
                ) : (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {selectedHypothesis.contradicting_evidence_ids.map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setExpandedEvidenceId(id)}
                        className="badge badge-rose font-mono text-[10px] cursor-pointer hover:bg-rose-200"
                        title={evidenceMap.get(id)?.summary || id}
                      >
                        ✕ {id}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Required Evidence Constraints & Missing Indicators */}
            {selectedHypothesis.required_evidence && selectedHypothesis.required_evidence.length > 0 && (
              <div className="bg-[#FAF4EB] p-3 border border-[#E7D6C0]" data-testid="hypothesis-required-evidence">
                <span className="font-mono text-xs font-bold text-[#8A5818] block mb-1">
                  Required Evidence Constraints ({selectedHypothesis.required_evidence.length}):
                </span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {selectedHypothesis.required_evidence.map((reqId) => {
                    const isPresent = evidenceMap.has(reqId);
                    return isPresent ? (
                      <span
                        key={reqId}
                        className="badge badge-emerald font-mono text-[10px]"
                        title={`Required evidence satisfied by ${reqId}`}
                      >
                        ✓ SATISFIED: {reqId}
                      </span>
                    ) : (
                      <span
                        key={reqId}
                        className="badge badge-rose font-mono text-[10px]"
                        title={`Required evidence missing: ${reqId}`}
                      >
                        ✕ MISSING: {reqId}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Diagnostics and Remediation recommendations */}
            {(selectedHypothesis.suggested_diagnostic || selectedHypothesis.suggested_remediation) && (
              <div className="flex flex-wrap gap-3 pt-2 border-t border-[#DFD7C7] text-xs font-mono">
                {selectedHypothesis.suggested_diagnostic && (
                  <div className="text-[#575044]">
                    <span>Suggested Diagnostic: </span>
                    <strong className="text-[#0E7490]">{selectedHypothesis.suggested_diagnostic}</strong>
                  </div>
                )}
                {selectedHypothesis.suggested_remediation && (
                  <div className="text-[#575044]">
                    <span>Suggested Remediation: </span>
                    <strong className="text-[#15803D]">
                      {selectedHypothesis.suggested_remediation.tool}
                    </strong>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Row 3: Evidence Graph & Collected Observations */}
      <div className="panel">
        <div className="panel-header">
          <div className="flex items-center gap-3">
            <h2 className="panel-title">
              <FileText className="w-4 h-4 text-[#0E7490]" />
              <span>Evidence Ledger & Observations</span>
            </h2>
            <div className="flex items-center gap-1">
              {(['all', 'direct_observation', 'diagnostic_result', 'contradictory'] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setEvidenceFilter(filter)}
                  className={`px-2 py-0.5 text-[10px] font-mono font-bold uppercase transition-colors ${
                    evidenceFilter === filter
                      ? 'bg-[#1C1917] text-[#FAF6F0]'
                      : 'bg-[#ECE6DC] text-[#6B6255] hover:text-[#1C1917]'
                  }`}
                >
                  {filter.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>
          <span className="badge badge-synthetic font-mono text-xs">
            {filteredEvidence.length} / {evidence.length} Items
          </span>
        </div>

        {filteredEvidence.length === 0 ? (
          <div className="p-8 text-center text-[#827869] font-mono text-xs">
            No evidence items match the selected filter.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredEvidence.map((ev) => {
              const isExpanded = expandedEvidenceId === ev.id;
              const hasData = ev.data && Object.keys(ev.data).length > 0;

              return (
                <div key={ev.id} data-testid={`evidence-row-${ev.id}`} className="p-3 border border-[#DFD7C7] bg-[#ECE6DC]">
                  <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-[#1C1917]">
                        {ev.id}
                      </span>
                      <span
                        className={`badge font-mono text-[10px] ${
                          ev.kind === 'contradictory'
                            ? 'badge-rose'
                            : ev.kind === 'diagnostic_result'
                            ? 'badge-cyan'
                            : 'badge-synthetic'
                        }`}
                      >
                        {ev.kind}
                      </span>
                      <span className="badge badge-synthetic font-mono text-[10px]">
                        Source: {ev.source}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-[#827869]">
                      {ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : ''}
                    </span>
                  </div>

                  <div className="text-xs font-sans text-[#1C1917]">{ev.summary}</div>

                  {hasData && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => setExpandedEvidenceId(isExpanded ? null : ev.id)}
                        className="payload-toggle font-mono text-[11px] flex items-center gap-1"
                      >
                        {isExpanded ? (
                          <>
                            <ChevronDown className="w-3.5 h-3.5" />
                            <span>Hide Structured Data</span>
                          </>
                        ) : (
                          <>
                            <ChevronRight className="w-3.5 h-3.5" />
                            <span>Inspect Observation Data</span>
                          </>
                        )}
                      </button>
                      {isExpanded && (
                        <pre className="payload-json text-xs mt-1">
                          {JSON.stringify(ev.data, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Row 4: Diagnostic Actions & Remediation History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Diagnostics Performed */}
        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">
              <Activity className="w-4 h-4 text-[#0E7490]" />
              <span>Diagnostics Performed</span>
            </h2>
            <span className="badge badge-synthetic font-mono text-xs">
              {diagnostics_performed.length} Executed
            </span>
          </div>

          {diagnostics_performed.length === 0 ? (
            <div className="p-8 text-center text-[#827869] font-mono text-xs">
              No diagnostic actions executed yet.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {diagnostics_performed.map((diag, idx) => {
                const isExpanded = expandedDiagnosticIdx === idx;
                return (
                  <div key={idx} className="p-3 border border-[#DFD7C7] bg-[#ECE6DC]">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-[#1C1917]">
                          {diag.tool}
                        </span>
                        <span className="badge badge-synthetic font-mono text-[10px]">
                          {diag.service}
                        </span>
                      </div>
                      <span
                        className={`badge font-mono text-[10px] ${
                          diag.success ? 'badge-emerald' : 'badge-rose'
                        }`}
                      >
                        {diag.success ? 'SUCCESS' : 'FAILED'}
                      </span>
                    </div>

                    {diag.error && (
                      <div className="text-xs text-red-700 font-mono mb-1">
                        Error: {diag.error}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => setExpandedDiagnosticIdx(isExpanded ? null : idx)}
                      className="payload-toggle font-mono text-[11px] flex items-center gap-1 mt-1"
                    >
                      {isExpanded ? (
                        <>
                          <ChevronDown className="w-3.5 h-3.5" />
                          <span>Hide Diagnostic Telemetry</span>
                        </>
                      ) : (
                        <>
                          <ChevronRight className="w-3.5 h-3.5" />
                          <span>View Diagnostic Telemetry</span>
                        </>
                      )}
                    </button>

                    {isExpanded && (
                      <pre className="payload-json text-xs mt-1">
                        {JSON.stringify(
                          {
                            arguments: diag.arguments,
                            data: diag.data,
                            timestamp: diag.timestamp,
                          },
                          null,
                          2
                        )}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Remediation & Replanning History */}
        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">
              <RotateCcw className="w-4 h-4 text-[#B45309]" />
              <span>Remediation & Replanning History</span>
            </h2>
            <span className="badge badge-synthetic font-mono text-xs">
              {remediation_history.length} Attempts
            </span>
          </div>

          {remediation_history.length === 0 ? (
            <div className="p-8 text-center text-[#827869] font-mono text-xs">
              No remediation actions attempted yet.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {remediation_history.map((rem, idx) => {
                const isExpanded = expandedRemediationIdx === idx;
                return (
                  <div key={rem.id || idx} className="p-3 border border-[#DFD7C7] bg-[#ECE6DC]">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-[#1C1917]">
                          Attempt #{rem.attempt}: {rem.tool}
                        </span>
                        {rem.policy_decision && (
                          <span className="badge badge-amber font-mono text-[10px]">
                            {rem.policy_decision}
                          </span>
                        )}
                      </div>
                      <span
                        className={`badge font-mono text-[10px] ${
                          rem.verification_passed === true
                            ? 'badge-emerald'
                            : rem.verification_passed === false
                            ? 'badge-rose'
                            : 'badge-synthetic'
                        }`}
                      >
                        {rem.verification_passed === true
                          ? 'VERIFIED'
                          : rem.verification_passed === false
                          ? 'VERIFICATION FAILED'
                          : 'UNVERIFIED'}
                      </span>
                    </div>

                    {rem.replanning_reason && (
                      <div className="text-xs text-[#78350F] bg-[#F7EEDC] p-2 border border-[#E6CE9F] font-mono my-1">
                        <strong>Replanning Reason:</strong> {rem.replanning_reason}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => setExpandedRemediationIdx(isExpanded ? null : idx)}
                      className="payload-toggle font-mono text-[11px] flex items-center gap-1 mt-1"
                    >
                      {isExpanded ? (
                        <>
                          <ChevronDown className="w-3.5 h-3.5" />
                          <span>Hide Remediation Details</span>
                        </>
                      ) : (
                        <>
                          <ChevronRight className="w-3.5 h-3.5" />
                          <span>View Execution & Verification Details</span>
                        </>
                      )}
                    </button>

                    {isExpanded && (
                      <pre className="payload-json text-xs mt-1">
                        {JSON.stringify(
                          {
                            originating_hypothesis_id: rem.originating_hypothesis_id,
                            arguments: rem.arguments,
                            execution_result: rem.execution_result,
                            verification_checks: rem.verification_checks,
                            approver_id: rem.approver_id,
                            timestamp: rem.timestamp,
                          },
                          null,
                          2
                        )}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Row 5: Adaptive Recovery & Replanning Narrative */}
      {replanning_cycle > 0 && (
        <div className="panel border-l-4 border-l-[#B45309]" data-testid="adaptive-recovery-section">
          <div className="panel-header">
            <h2 className="panel-title">
              <RotateCcw className="w-4 h-4 text-[#B45309]" />
              <span>Adaptive Recovery Narrative ({replanning_cycle} {replanning_cycle === 1 ? 'Cycle' : 'Cycles'})</span>
            </h2>
            <span className="badge badge-amber font-mono text-xs">
              Cycle #{replanning_cycle}
            </span>
          </div>

          <div className="text-xs text-[#575044] mb-3">
            The autonomous investigator adapted its hypothesis and recovery plan after observing post-action evidence or failed verification.
          </div>

          <div className="flex flex-col gap-2">
            {remediation_history.map((rem, idx) => (
              <div key={rem.id || idx} className="p-3 bg-[#FAF6F0] border border-[#DFD7C7] flex flex-col gap-1.5 font-mono text-xs">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[#1C1917]">
                      Cycle Step #{rem.attempt}: {rem.tool}
                    </span>
                    <span className="badge badge-synthetic text-[10px]">
                      {rem.service}
                    </span>
                  </div>
                  <span
                    className={`badge text-[10px] ${
                      rem.verification_passed === true
                        ? 'badge-emerald'
                        : rem.verification_passed === false
                        ? 'badge-rose'
                        : rem.policy_decision === 'BLOCKED'
                        ? 'badge-rose'
                        : 'badge-amber'
                    }`}
                  >
                    {rem.verification_passed === true
                      ? 'VERIFIED'
                      : rem.verification_passed === false
                      ? 'FAILED'
                      : rem.policy_decision === 'BLOCKED'
                      ? 'BLOCKED'
                      : 'UNVERIFIED'}
                  </span>
                </div>

                {rem.originating_hypothesis_id && (
                  <div className="text-[11px] text-[#6B6255]">
                    Target Hypothesis: <span className="font-bold text-[#0E7490]">{rem.originating_hypothesis_id}</span>
                  </div>
                )}

                {rem.replanning_reason && (
                  <div className="p-2 bg-[#F7EEDC] border border-[#E6CE9F] text-[#78350F] text-[11px]">
                    <strong className="uppercase">Replanning Trigger:</strong> {rem.replanning_reason}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Row 6: Independent Verification Proof */}
      {remediation_history.some((r) => (r.verification_checks && r.verification_checks.length > 0) || (r.verification_passed !== undefined && r.verification_passed !== null)) && (
        <div className="panel" data-testid="verification-proof-panel">
          <div className="panel-header">
            <h2 className="panel-title">
              <Shield className="w-4 h-4 text-[#0E7490]" />
              <span>Independent Verification Proof</span>
            </h2>
            {remediation_history.some((r) => r.verification_passed === true) ? (
              <span className="badge badge-emerald font-mono text-xs">
                RECOVERY PROVEN
              </span>
            ) : remediation_history.some((r) => r.verification_passed === false) ? (
              <span className="badge badge-rose font-mono text-xs">
                VERIFICATION FAILED
              </span>
            ) : (
              <span className="badge badge-synthetic font-mono text-xs">
                AWAITING PROOF
              </span>
            )}
          </div>

          {/* Verification banners */}
          {remediation_history.some((r) => r.verification_passed === true) && (
            <div
              className="p-3 bg-[#E7F0E5] border border-[#BCD5B8] text-xs font-mono text-emerald-950 flex items-center justify-between gap-2"
              data-testid="recovery-verified-banner"
            >
              <div className="flex items-center gap-2">
                <span className="font-bold">✓ RECOVERY VERIFIED:</span>
                <span>All mandatory invariants passed independent verification.</span>
              </div>
            </div>
          )}

          {remediation_history.some((r) => r.verification_passed === false) && !remediation_history.some((r) => r.verification_passed === true) && (
            <div
              className="p-3 bg-[#F8E7E7] border border-[#E8B8B8] text-xs font-mono text-rose-950 flex items-center justify-between gap-2"
              data-testid="recovery-not-proven-banner"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-700 flex-shrink-0" />
                <div>
                  <strong className="text-rose-900">RECOVERY NOT PROVEN:</strong>{' '}
                  <span>One or more post-remediation invariant checks failed or produced contradictory observations.</span>
                </div>
              </div>
            </div>
          )}

          {/* Per-invariant check breakdown */}
          <div className="flex flex-col gap-3 mt-2">
            {remediation_history.map((rem, rIdx) => {
              const checks = rem.verification_checks || [];
              if (checks.length === 0) return null;
              return (
                <div key={rem.id || rIdx} className="bg-[#ECE6DC] p-3 border border-[#DFD7C7]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-xs font-bold text-[#1C1917]">
                      Attempt #{rem.attempt} Invariant Checks ({rem.tool})
                    </span>
                    <span
                      className={`badge font-mono text-[10px] ${
                        rem.verification_passed === true
                          ? 'badge-emerald'
                          : rem.verification_passed === false
                          ? 'badge-rose'
                          : 'badge-synthetic'
                      }`}
                    >
                      {rem.verification_passed === true
                        ? 'VERIFIED'
                        : rem.verification_passed === false
                        ? 'FAILED'
                        : 'UNVERIFIED'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {checks.map((check, cIdx) => (
                      <div
                        key={cIdx}
                        className={`p-2.5 border text-xs font-mono flex flex-col gap-1 ${
                          check.passed
                            ? 'border-[#BCD5B8] bg-[#F2F7F1]'
                            : 'border-[#E8B8B8] bg-[#FCF3F3]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-[#1C1917]">{check.check_name}</span>
                          <span
                            className={`badge font-mono text-[10px] ${
                              check.passed ? 'badge-emerald' : 'badge-rose'
                            }`}
                          >
                            {check.passed ? 'PASS' : 'FAIL'}
                          </span>
                        </div>
                        {check.observed && Object.keys(check.observed).length > 0 && (
                          <div className="text-[11px] text-[#575044] bg-[#FAF6F0] p-1.5 border border-[#DFD7C7] mt-1 overflow-x-auto">
                            <span className="text-[#827869] block text-[9px] uppercase">Observed:</span>
                            <pre className="text-[10px] font-mono leading-tight">
                              {JSON.stringify(check.observed, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
};
