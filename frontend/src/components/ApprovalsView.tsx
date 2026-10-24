import React, { useState } from 'react';
import {
  ShieldAlert,
  AlertTriangle,
  Lock,
  Check,
  X,
  RefreshCw,
  Clock,
  ArrowRight,
  ShieldCheck,
  Layers,
  Shield,
  Download,
} from 'lucide-react';
import { ActionDetail, Event, IncidentResponse, IncidentSummaryItem } from '../types';
import { ActionInspector } from './ActionInspector';
import { ActionLifecycleTimeline } from './ActionLifecycleTimeline';
import { PolicyDecisionExplorer } from './PolicyDecisionExplorer';

interface ApprovalsViewProps {
  activeIncident: IncidentResponse | null;
  incidentsList: IncidentSummaryItem[];
  onSelectIncident: (incidentId: string) => void;
  onSubmitApproval: (
    incidentId: string,
    decision: 'approve' | 'deny',
    approverId: string,
    comment: string
  ) => Promise<void>;
  isSubmitting: boolean;
  approvalError: string | null;
  lastDecisionResponse: IncidentResponse | null;
  onRefresh: () => void;
  isLoading: boolean;
}

export const ApprovalsView: React.FC<ApprovalsViewProps> = ({
  activeIncident,
  incidentsList,
  onSelectIncident,
  onSubmitApproval,
  isSubmitting,
  approvalError,
  lastDecisionResponse,
  onRefresh,
  isLoading,
}) => {
  const [approverId, setApproverId] = useState('governance-reviewer');
  const [comment, setComment] = useState('Reviewed proposed action against client policy.');
  const [activeTab, setActiveTab] = useState<'decision' | 'policy' | 'lifecycle'>('decision');

  // Find all incidents currently in PENDING_APPROVAL status
  const pendingIncidents = incidentsList.filter(
    (inc) => inc.outcome === 'PENDING_APPROVAL'
  );

  // Check if active incident has a pending approval request
  const isCurrentIncidentPending =
    activeIncident?.outcome === 'PENDING_APPROVAL';

  // Extract the approval_requested event if present in activeIncident
  const approvalEvent: Event | undefined = activeIncident?.events
    ?.slice()
    ?.reverse()
    ?.find((ev) => ev.type === 'approval_requested');

  const payload = approvalEvent?.payload || {};

  // Build an ActionDetail representation from active incident state
  const currentActionDetail: ActionDetail = {
    actionId: approvalEvent?.event_id,
    tool: payload.tool || 'rollback_config',
    service: payload.service || 'checkout-service',
    arguments: payload.arguments || {},
    incidentId: activeIncident?.incident_id,
    attempt: payload.attempt,
    investigationStep: payload.investigation_step,
    rationale: payload.reason,
    supportingEvidenceRefs: approvalEvent?.evidence_refs || [],
    policyDecision: 'APPROVAL_REQUIRED',
    policyRuleId: payload.rule_id || 'POL-DEFAULT',
    policyReason: payload.reason || 'Operation requires authorization prior to simulator execution.',
    approvalRequired: true,
    approvalState: isCurrentIncidentPending ? 'pending' : null,
    executionStatus: 'not_started',
    verificationOutcome: 'pending',
    timestamp: approvalEvent?.timestamp,
    actor: approvalEvent?.actor,
    expectedImpact: payload.expected_impact,
    reversibility: payload.reversibility,
  };

  const exportAuditTrail = () => {
    const auditData = {
      exportedAt: new Date().toISOString(),
      incidentId: activeIncident?.incident_id || 'system-wide',
      scenario: activeIncident?.scenario,
      outcome: activeIncident?.outcome,
      policyDecisions: activeIncident?.events?.filter((e) => e.type === 'policy_decision') || [],
      approvalEvents: activeIncident?.events?.filter(
        (e) => e.type === 'approval_requested' || e.type === 'human_approval_decision'
      ) || [],
      verificationChecks: activeIncident?.events?.filter((e) => e.type === 'verification_check') || [],
    };
    const blob = new Blob([JSON.stringify(auditData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-trail-${activeIncident?.incident_id || 'incidents'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDecision = async (decision: 'approve' | 'deny') => {
    if (!activeIncident?.incident_id || !approverId.trim()) return;
    await onSubmitApproval(
      activeIncident.incident_id,
      decision,
      approverId.trim(),
      comment.trim()
    );
  };

  return (
    <div className="w-full flex flex-col gap-6" data-testid="approvals-view">
      {/* Header Banner */}
      <div className="panel border-l-4 border-l-amber-500 flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-[#DFD7C7] pb-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-500 text-white flex items-center justify-center font-mono">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-mono font-bold uppercase tracking-wider text-[#1C1917]">
                  HUMAN APPROVAL GOVERNANCE GATE
                </h1>
                <span
                  className={`badge font-mono text-[10px] ${
                    pendingIncidents.length > 0 ? 'badge-amber' : 'badge-emerald'
                  }`}
                >
                  {pendingIncidents.length} ACTION{pendingIncidents.length === 1 ? '' : 'S'} PENDING APPROVAL
                </span>
              </div>
              <p className="text-xs text-[#6B6255] font-sans mt-0.5">
                Inspect sensitive remediation actions, explore deterministic policy rules, and authorize execution.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exportAuditTrail}
              className="btn btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 font-mono"
              title="Export audit log as structured JSON"
              data-testid="export-audit-btn"
            >
              <Download className="w-3.5 h-3.5" />
              <span>EXPORT AUDIT</span>
            </button>
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              className="btn btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 font-mono"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>REFRESH QUEUE</span>
            </button>
          </div>
        </div>

        {/* Informational Guidance: Authoritative Boundary */}
        <div className="text-xs font-mono text-[#575044] leading-relaxed bg-[#ECE6DC] p-3 border border-[#DFD7C7]">
          <strong className="text-[#1C1917]">AUTHORIZATION BOUNDARY:</strong> The backend server is the authoritative enforcement point. Approving an action schedules synthetic execution; recovery is only confirmed after independent verifiers run.
        </div>

        {/* View Tabs */}
        <div className="flex items-center gap-1 pt-1 border-t border-[#DFD7C7]">
          <button
            type="button"
            onClick={() => setActiveTab('decision')}
            className={`px-3 py-1.5 text-xs font-mono font-bold uppercase transition-colors flex items-center gap-1.5 ${
              activeTab === 'decision'
                ? 'bg-[#1C1917] text-[#FAF6F0]'
                : 'bg-[#ECE6DC] text-[#6B6255] hover:text-[#1C1917]'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Human Gate & Decision</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('lifecycle')}
            className={`px-3 py-1.5 text-xs font-mono font-bold uppercase transition-colors flex items-center gap-1.5 ${
              activeTab === 'lifecycle'
                ? 'bg-[#1C1917] text-[#FAF6F0]'
                : 'bg-[#ECE6DC] text-[#6B6255] hover:text-[#1C1917]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Lifecycle Timeline</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('policy')}
            className={`px-3 py-1.5 text-xs font-mono font-bold uppercase transition-colors flex items-center gap-1.5 ${
              activeTab === 'policy'
                ? 'bg-[#1C1917] text-[#FAF6F0]'
                : 'bg-[#ECE6DC] text-[#6B6255] hover:text-[#1C1917]'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Policy Decision Explorer</span>
          </button>
        </div>
      </div>

      {/* Tab 1: Human Gate & Decision (with Action Inspector) */}
      {activeTab === 'decision' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left 2 Cols: Active Approval Decision Card & Detailed Inspector */}
          <div className="lg:col-span-2 flex flex-col gap-4">
            {isCurrentIncidentPending ? (
              <div
                className="border-2 border-amber-500 bg-[#FAF6F0] p-6 flex flex-col gap-4 shadow-sm"
                data-testid="active-approval-card"
              >
                {/* Alert Header */}
                <div className="flex items-center justify-between border-b border-amber-200 pb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-amber-500 text-white flex items-center justify-center">
                      <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold tracking-wider uppercase text-amber-950 font-mono">
                        ACTION REQUIRING HUMAN AUTHORIZATION
                      </h2>
                      <span className="text-xs text-amber-800 font-mono">
                        Incident ID: <strong className="font-bold">{activeIncident.incident_id}</strong>
                      </span>
                    </div>
                  </div>
                  <span className="badge badge-amber font-mono text-xs">
                    GATE: APPROVAL_REQUIRED
                  </span>
                </div>

                {/* Reusable Action Inspector Card */}
                <ActionInspector action={currentActionDetail} />

                {/* Safety Boundary Active Notice */}
                <div className="p-3 bg-[#F8E7E7] border-l-4 border-rose-600 text-xs text-rose-900 leading-relaxed font-sans">
                  <div className="flex items-center gap-1.5 font-bold mb-0.5 font-mono">
                    <Lock className="w-3.5 h-3.5" />
                    <span>Execution Paused at Safety Gate:</span>
                  </div>
                  The target service simulator has not been modified. Tool invocation is blocked until an explicit human authorization is recorded by the server.
                </div>

                {/* Error Banner */}
                {approvalError && (
                  <div className="p-3 bg-red-100 border border-red-300 text-red-900 text-xs font-mono">
                    <div className="font-bold">✕ {approvalError}</div>
                    {approvalError.includes('Conflict') && (
                      <div className="mt-1 text-[11px] text-red-800">
                        This action has already been resolved or is no longer eligible. Click "REFRESH QUEUE" to update state.
                      </div>
                    )}
                  </div>
                )}

                {/* Identity & Comments Inputs */}
                <div className="flex flex-col gap-3 pt-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-mono uppercase tracking-wider text-[#6B6255] block mb-1">
                        Approver Identity (Audit Log):
                      </label>
                      <input
                        type="text"
                        value={approverId}
                        onChange={(e) => setApproverId(e.target.value)}
                        disabled={isSubmitting}
                        className="w-full text-xs font-mono"
                        placeholder="reviewer-id"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-mono uppercase tracking-wider text-[#6B6255] block mb-1">
                        Audit Comment:
                      </label>
                      <input
                        type="text"
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        disabled={isSubmitting}
                        className="w-full text-xs"
                        placeholder="Reason for decision"
                      />
                    </div>
                  </div>

                  {/* Approve & Deny Controls */}
                  <div className="flex gap-3 mt-1">
                    <button
                      type="button"
                      className="btn btn-success flex-1 py-2.5 flex items-center justify-center gap-2"
                      onClick={() => handleDecision('approve')}
                      disabled={isSubmitting || !approverId.trim()}
                    >
                      <Check className="w-4 h-4" />
                      <span>{isSubmitting ? 'Recording Decision...' : 'Authorize & Execute'}</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger flex-1 py-2.5 flex items-center justify-center gap-2"
                      onClick={() => handleDecision('deny')}
                      disabled={isSubmitting || !approverId.trim()}
                    >
                      <X className="w-4 h-4" />
                      <span>{isSubmitting ? 'Recording Decision...' : 'Reject Action'}</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="panel p-10 flex flex-col items-center justify-center text-center gap-3">
                <ShieldCheck className="w-10 h-10 text-emerald-600 mb-1" />
                <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-[#1C1917]">
                  NO PENDING APPROVAL FOR ACTIVE INCIDENT
                </h2>
                <p className="text-xs text-[#827869] max-w-md leading-relaxed">
                  {activeIncident
                    ? `The currently selected incident (${activeIncident.incident_id.slice(0, 8)}...) is in ${activeIncident.outcome} status and is not awaiting human decision.`
                    : 'Select an incident from the queue on the right to inspect its approval request.'}
                </p>
              </div>
            )}

            {/* Last Recorded Decision Feedback */}
            {lastDecisionResponse && (
              <div className="p-4 bg-[#E7F0E5] border border-[#BCD5B8] text-xs font-mono flex flex-col gap-1.5">
                <div className="flex items-center gap-2 font-bold text-emerald-900">
                  <Check className="w-4 h-4 text-emerald-700" />
                  <span>APPROVAL DECISION RECORDED BY SERVER</span>
                </div>
                <div className="text-emerald-800">
                  Incident <strong>{lastDecisionResponse.incident_id}</strong> updated to outcome:{' '}
                  <strong className="underline">{lastDecisionResponse.outcome}</strong>.
                </div>
                <div className="text-[11px] text-emerald-700 font-sans">
                  {lastDecisionResponse.summary}
                </div>
              </div>
            )}
          </div>

          {/* Right Col: All Incidents Awaiting Approval Queue */}
          <div className="panel flex flex-col gap-3">
            <div className="panel-header">
              <h2 className="panel-title">
                <Clock className="w-4 h-4 text-amber-600" />
                <span>Pending Approvals Queue</span>
              </h2>
              <span className="badge badge-synthetic font-mono text-[10px]">
                {pendingIncidents.length} Pending
              </span>
            </div>

            {pendingIncidents.length === 0 ? (
              <div className="p-8 text-center text-[#827869] font-mono text-xs">
                All clear. No incidents currently awaiting human authorization across the store.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {pendingIncidents.map((inc) => {
                  const isSelected = inc.incident_id === activeIncident?.incident_id;

                  return (
                    <div
                      key={inc.incident_id}
                      onClick={() => onSelectIncident(inc.incident_id)}
                      className={`p-3 border cursor-pointer transition-colors ${
                        isSelected
                          ? 'border-amber-500 bg-[#FAF6F0] ring-1 ring-amber-500'
                          : 'border-[#DFD7C7] bg-[#ECE6DC] hover:border-[#827869] hover:bg-[#FAF6F0]'
                      }`}
                      data-testid={`pending-queue-item-${inc.incident_id}`}
                    >
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-mono text-xs font-bold text-[#1C1917]">
                          {inc.incident_id.slice(0, 10)}...
                        </span>
                        <span className="badge badge-amber font-mono text-[9px]">
                          APPROVAL NEEDED
                        </span>
                      </div>

                      <div className="text-xs text-[#575044] font-sans line-clamp-1 mb-2">
                        {inc.summary}
                      </div>

                      <div className="flex justify-between items-center text-[10px] font-mono text-[#827869]">
                        <span>Scenario: {inc.scenario}</span>
                        <span className="text-[#0E7490] font-bold flex items-center gap-0.5">
                          {isSelected ? 'LOADED' : 'REVIEW'}
                          <ArrowRight className="w-2.5 h-2.5" />
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Action Lifecycle Timeline */}
      {activeTab === 'lifecycle' && (
        <ActionLifecycleTimeline
          events={activeIncident?.events || []}
          activeIncident={activeIncident}
        />
      )}

      {/* Tab 3: Policy Decision Explorer */}
      {activeTab === 'policy' && (
        <PolicyDecisionExplorer
          events={activeIncident?.events || []}
          activeIncident={activeIncident}
        />
      )}
    </div>
  );
};
