import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  CustomScenarioParams,
  Event,
  HealthResponse,
  IncidentResponse,
  IncidentSummaryItem,
  InvestigationState,
  ScenariosResponse,
  VerificationCheck,
  VerificationReport,
} from './types';
import {
  fetchHealth,
  fetchIncidents,
  fetchIncident,
  fetchInvestigation,
  fetchScenarios,
  startIncident,
  submitApproval,
  subscribeToEvents,
  SseSubscription,
  ApiError,
} from './api/client';
import { Header, ActiveViewKey } from './components/Header';
import { ProofLoopHero } from './components/ProofLoopHero';
import { IncidentLauncher } from './components/IncidentLauncher';
import { ApprovalCard } from './components/ApprovalCard';
import { VerificationPanel } from './components/VerificationPanel';
import { EventTimeline } from './components/EventTimeline';
import { IncidentHistory } from './components/IncidentHistory';
import { BenchmarkView } from './components/BenchmarkView';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
import { InvestigationView } from './components/InvestigationView';
import { IncidentsView } from './components/IncidentsView';
import { ApprovalsView } from './components/ApprovalsView';
import { ActionLifecycleTimeline } from './components/ActionLifecycleTimeline';
import { PolicyDecisionExplorer } from './components/PolicyDecisionExplorer';
import { Terminal, Layers, Shield } from 'lucide-react';

export const App: React.FC = () => {
  const [activeView, setActiveView] = useState<ActiveViewKey>('operations');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [scenariosData, setScenariosData] = useState<ScenariosResponse | null>(null);
  const [isLoadingScenarios, setIsLoadingScenarios] = useState(true);

  const [activeIncidentId, setActiveIncidentId] = useState<string | null>(null);
  const [activeIncident, setActiveIncident] = useState<IncidentResponse | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'disconnected' | 'completed'
  >('disconnected');

  const [isLaunching, setIsLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [latestChecks, setLatestChecks] = useState<VerificationCheck[]>([]);
  const [verificationReport, setVerificationReport] = useState<VerificationReport | null>(null);
  const [observedHealthStatus, setObservedHealthStatus] = useState<number | undefined>(undefined);

  // Investigation state
  const [investigationState, setInvestigationState] = useState<InvestigationState | null>(null);
  const [isLoadingInvestigation, setIsLoadingInvestigation] = useState(false);
  const [investigationError, setInvestigationError] = useState<string | null>(null);

  // Approvals & Governance state
  const [pendingApprovalEvent, setPendingApprovalEvent] = useState<Event | null>(null);
  const [isSubmittingApproval, setIsSubmittingApproval] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [lastDecisionResponse, setLastDecisionResponse] = useState<IncidentResponse | null>(null);

  // Operations bottom tab: 'timeline' | 'lifecycle' | 'policy'
  const [opsAuditTab, setOpsAuditTab] = useState<'timeline' | 'lifecycle' | 'policy'>('timeline');

  // Incidents history
  const [incidentsList, setIncidentsList] = useState<IncidentSummaryItem[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const sseSubscriptionRef = useRef<SseSubscription | null>(null);
  const operationsAnchorRef = useRef<HTMLDivElement | null>(null);

  // Count pending approvals
  const pendingApprovalsCount = incidentsList.filter(
    (inc) => inc.outcome === 'PENDING_APPROVAL'
  ).length;

  // Load initial backend health and scenarios
  useEffect(() => {
    async function init() {
      try {
        const [h, s] = await Promise.all([fetchHealth(), fetchScenarios()]);
        setHealth(h);
        setScenariosData(s);
      } catch (err: any) {
        setLaunchError(`Failed to connect to ProofLoop backend at API base URL. ${err.message}`);
      } finally {
        setIsLoadingScenarios(false);
      }
    }
    init();
  }, []);

  // Load history list
  const loadHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    setHistoryError(null);
    try {
      const list = await fetchIncidents(50);
      setIncidentsList(list);
    } catch (err: any) {
      setHistoryError(err.message || 'Could not fetch history list');
      console.warn('Could not fetch history list', err);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Clean up SSE subscription on unmount
  useEffect(() => {
    return () => {
      sseSubscriptionRef.current?.close();
    };
  }, []);

  // Fetch investigation helper
  const loadInvestigation = useCallback(async (incidentId: string) => {
    setIsLoadingInvestigation(true);
    setInvestigationError(null);
    try {
      const inv = await fetchInvestigation(incidentId);
      setInvestigationState(inv);
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 404) {
        setInvestigationState(null);
      } else {
        setInvestigationError(err.detail || err.message || 'Failed to fetch investigation');
      }
    } finally {
      setIsLoadingInvestigation(false);
    }
  }, []);

  // Process incoming event to update UI states
  const handleIncomingEvent = useCallback(
    (event: Event) => {
      setEvents((prev) => {
        if (prev.some((e) => e.event_id === event.event_id || (e.sequence && e.sequence === event.sequence))) {
          return prev;
        }
        return [...prev, event];
      });

      if (event.type === 'approval_requested') {
        setPendingApprovalEvent(event);
        setActiveIncident((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            outcome: 'PENDING_APPROVAL',
            summary: event.payload?.reason || 'Waiting for human authorization.',
          };
        });
        loadHistory();
      } else if (
        event.type === 'human_approval_decision' ||
        event.type === 'approval_rejected_by_policy'
      ) {
        setPendingApprovalEvent(null);
        loadHistory();
      }

      if (event.type === 'verification_check') {
        const check: VerificationCheck = {
          check_name: event.payload?.check_name || 'unknown',
          passed: Boolean(event.payload?.passed),
          observed: event.payload?.observed || {},
        };
        setLatestChecks((prev) => {
          const next = prev.filter((c) => c.check_name !== check.check_name);
          return [...next, check];
        });
      }

      if (event.type === 'verification_result') {
        setVerificationReport({
          all_passed: Boolean(event.payload?.all_passed),
          checks: event.payload?.checks || [],
        });
      }

      if (event.type === 'evidence_collected' || event.type === 'tool_executed') {
        if (event.payload?.result?.health_endpoint_status !== undefined) {
          setObservedHealthStatus(event.payload.result.health_endpoint_status);
        }
      }

      // Re-fetch investigation when evidence or replanning events arrive
      if (
        event.type === 'evidence_collected' ||
        event.type === 'evidence_correlated' ||
        event.type === 'post_action_evidence_observed' ||
        event.type === 'replanning_started' ||
        event.type === 'hypothesis_revised_after_remediation' ||
        event.type === 'outcome'
      ) {
        if (event.incident_id) {
          loadInvestigation(event.incident_id);
        }
      }

      if (event.type === 'outcome') {
        setActiveIncident((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            outcome: event.payload?.outcome || prev.outcome,
            summary: event.payload?.summary || prev.summary,
          };
        });
        setPendingApprovalEvent(null);
        loadHistory();
      }
    },
    [loadHistory, loadInvestigation]
  );

  // Launch a new incident
  const handleLaunchIncident = async (
    scenario: string,
    client: string,
    mode: string,
    customParams?: CustomScenarioParams
  ) => {
    setIsLaunching(true);
    setLaunchError(null);
    setApprovalError(null);
    setPendingApprovalEvent(null);
    setLatestChecks([]);
    setVerificationReport(null);
    setObservedHealthStatus(undefined);
    setInvestigationState(null);
    setEvents([]);

    sseSubscriptionRef.current?.close();
    sseSubscriptionRef.current = null;

    try {
      const startRes = await startIncident(scenario, client, mode, customParams);
      setActiveIncidentId(startRes.incident_id);
      setActiveIncident({
        incident_id: startRes.incident_id,
        scenario,
        client,
        outcome: startRes.outcome,
        summary: 'Incident queued and running in background worker.',
        mode,
        events: [],
      });

      sseSubscriptionRef.current = subscribeToEvents(
        startRes.incident_id,
        {
          onEvent: handleIncomingEvent,
          onStatusChange: setConnectionStatus,
        },
        0
      );

      setTimeout(() => {
        loadInvestigation(startRes.incident_id);
      }, 500);
    } catch (err: any) {
      setLaunchError(err.message || 'Failed to start incident simulation');
      setConnectionStatus('disconnected');
    } finally {
      setIsLaunching(false);
    }
  };

  // Replay / select a historical incident
  const handleSelectHistoricalIncident = async (incidentId: string) => {
    sseSubscriptionRef.current?.close();
    sseSubscriptionRef.current = null;
    setConnectionStatus('disconnected');

    setLaunchError(null);
    setApprovalError(null);
    setPendingApprovalEvent(null);
    setLatestChecks([]);
    setVerificationReport(null);
    setObservedHealthStatus(undefined);
    setEvents([]);
    setInvestigationState(null);

    try {
      const res = await fetchIncident(incidentId);
      setActiveIncidentId(res.incident_id);
      setActiveIncident(res);
      setEvents(res.events || []);

      if (res.investigation_state) {
        setInvestigationState(res.investigation_state);
      } else {
        loadInvestigation(res.incident_id);
      }

      const checks: VerificationCheck[] = [];
      let pendingEvent: Event | null = null;

      (res.events || []).forEach((ev) => {
        if (ev.type === 'approval_requested') {
          pendingEvent = ev;
        } else if (
          ev.type === 'human_approval_decision' ||
          ev.type === 'approval_rejected_by_policy' ||
          ev.type === 'outcome'
        ) {
          pendingEvent = null;
        }

        if (ev.type === 'verification_check') {
          checks.push({
            check_name: ev.payload?.check_name,
            passed: Boolean(ev.payload?.passed),
            observed: ev.payload?.observed || {},
          });
        }
        if (ev.type === 'verification_result') {
          setVerificationReport({
            all_passed: Boolean(ev.payload?.all_passed),
            checks: ev.payload?.checks || [],
          });
        }
      });

      setLatestChecks(checks);

      if (res.outcome === 'PENDING_APPROVAL') {
        setPendingApprovalEvent(pendingEvent);
      } else {
        setPendingApprovalEvent(null);
      }

      if (res.outcome === 'PENDING_APPROVAL' || res.outcome === 'RUNNING') {
        const lastSequence = (res.events || []).reduce(
          (max, ev) => Math.max(max, ev.sequence ?? 0),
          0
        );
        sseSubscriptionRef.current = subscribeToEvents(
          res.incident_id,
          {
            onEvent: handleIncomingEvent,
            onStatusChange: setConnectionStatus,
          },
          lastSequence
        );
      } else {
        setConnectionStatus('completed');
      }
    } catch (err: any) {
      setLaunchError(`Failed to load historical incident: ${err.message}`);
    }
  };

  // Submit human approval decision
  const handleSubmitApproval = async (
    incidentId: string,
    decision: 'approve' | 'deny',
    approverId: string,
    comment: string
  ) => {
    setIsSubmittingApproval(true);
    setApprovalError(null);

    try {
      const updated = await submitApproval(incidentId, {
        decision,
        approver_id: approverId,
        comment,
      });

      setLastDecisionResponse(updated);
      setPendingApprovalEvent(null);
      setActiveIncident(updated);
      if (updated.events) {
        setEvents(updated.events);
      }
      if (updated.investigation_state) {
        setInvestigationState(updated.investigation_state);
      } else {
        loadInvestigation(incidentId);
      }
      loadHistory();
    } catch (err: any) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setApprovalError('Conflict: This approval request has already been processed or resolved.');
        } else if (err.status === 404) {
          setApprovalError('Not Found: Pending approval record does not exist on server.');
        } else if (err.status === 403) {
          setApprovalError('Forbidden: Unauthorized to record approval decision.');
        } else if (err.status === 422) {
          setApprovalError(`Validation Error: ${err.detail}`);
        } else {
          setApprovalError(err.detail || err.message);
        }
      } else {
        setApprovalError(err.message || 'Failed to submit approval decision');
      }
    } finally {
      setIsSubmittingApproval(false);
    }
  };

  const handleSelectView = (view: ActiveViewKey) => {
    setActiveView(view);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const scrollToOperations = () => {
    setActiveView('operations');
    setTimeout(() => {
      operationsAnchorRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  };

  // Determine which view to render
  let viewContent: JSX.Element | null = null;

  if (activeView === 'dashboard') {
    viewContent = (
      <AnalyticsDashboard
        incidents={incidentsList}
        isLoading={isLoadingHistory}
        onRefresh={loadHistory}
        onSelectIncident={handleSelectHistoricalIncident}
        onNavigateToView={handleSelectView}
      />
    );
  } else if (activeView === 'benchmark') {
    viewContent = (
      <BenchmarkView
        availableScenarios={scenariosData?.scenarios}
        availableClients={scenariosData?.clients}
      />
    );
  } else if (activeView === 'investigations') {
    viewContent = (
      <InvestigationView
        activeIncident={activeIncident}
        investigation={investigationState}
        isLoading={isLoadingInvestigation}
        error={investigationError}
        onRetry={() => {
          if (activeIncidentId) loadInvestigation(activeIncidentId);
        }}
        onSelectIncident={handleSelectHistoricalIncident}
        allIncidents={incidentsList}
      />
    );
  } else if (activeView === 'incidents') {
    viewContent = (
      <IncidentsView
        incidents={incidentsList}
        isLoading={isLoadingHistory}
        error={historyError}
        selectedIncidentId={activeIncidentId}
        onSelectIncident={handleSelectHistoricalIncident}
        onRefresh={loadHistory}
        onNavigateToView={handleSelectView}
      />
    );
  } else if (activeView === 'approvals') {
    viewContent = (
      <ApprovalsView
        activeIncident={activeIncident}
        incidentsList={incidentsList}
        onSelectIncident={handleSelectHistoricalIncident}
        onSubmitApproval={handleSubmitApproval}
        isSubmitting={isSubmittingApproval}
        approvalError={approvalError}
        lastDecisionResponse={lastDecisionResponse}
        onRefresh={loadHistory}
        isLoading={isLoadingHistory}
      />
    );
  } else {
    // Default 'operations' view
    viewContent = (
      <>
        {/* Hero Section */}
        <div className="mb-8">
          <ProofLoopHero
            activeView={activeView}
            onStartClick={scrollToOperations}
            onBenchmarkClick={() => handleSelectView('benchmark')}
          />
        </div>

        {/* Main Workspace */}
        <div ref={operationsAnchorRef} className="w-full flex flex-col gap-6">
          {/* Command Deck Header */}
          <div className="flex flex-col sm:flex-row items-center justify-between border-b border-gray-800 pb-3.5 gap-2 text-center sm:text-left">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 bg-cyan-500"></span>
              <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-gray-100">
                AGENTOPS INCIDENT COMMAND DECK
              </h2>
            </div>
            <span className="text-[11px] font-mono text-gray-500">
              ACTIVE CLIENT POLICY: STANDARD ENFORCEMENT
            </span>
          </div>

          {/* Row 1: Launcher & Active State / Approval Gate */}
          <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
            {/* Incident Launcher */}
            <IncidentLauncher
              scenariosData={scenariosData}
              isLoadingScenarios={isLoadingScenarios}
              onLaunch={handleLaunchIncident}
              isLaunching={isLaunching}
              error={launchError}
            />

            {/* Right Column: Approval Card or Active Incident Status */}
            {activeIncident?.outcome === 'PENDING_APPROVAL' && pendingApprovalEvent ? (
              <ApprovalCard
                incidentId={activeIncident.incident_id}
                pendingEvent={pendingApprovalEvent}
                onSubmitApproval={(decision, apprvId, cmt) =>
                  handleSubmitApproval(activeIncident.incident_id, decision, apprvId, cmt)
                }
                isSubmitting={isSubmittingApproval}
                approvalError={approvalError}
              />
            ) : activeIncident ? (
              <div className="panel rounded-lg border border-gray-700 bg-gray-950">
                <div className="panel-header px-4 py-2.5 border-b border-gray-700">
                  <span className="panel-title font-mono text-xs">
                    <span>📌</span>
                    <span>
                      Active Run:{' '}
                      <span className="font-mono text-cyan-400">
                        {activeIncident.incident_id.slice(0, 8)}...
                      </span>
                    </span>
                  </span>
                  <span
                    className={`badge font-mono text-xs ${
                      activeIncident.outcome === 'VERIFIED'
                        ? 'bg-cyan-400'
                        : activeIncident.outcome === 'BLOCKED'
                        ? 'bg-rose-400'
                        : activeIncident.outcome === 'ESCALATED'
                        ? 'bg-amber-400'
                        : activeIncident.outcome === 'PENDING_APPROVAL'
                        ? 'bg-amber-400'
                        : 'bg-cyan-400'
                    }`}
                  >
                    {activeIncident.outcome}
                  </span>
                </div>
                <div className="text-xs text-gray-400 font-sans leading-relaxed px-4 pb-3">
                  {activeIncident.summary}
                </div>
                <div className="flex gap-2 text-xs font-mono text-gray-500 border-t border-gray-700 pt-2 px-4">
                  <span>
                    SCENARIO: <strong className="text-gray-100">{activeIncident.scenario}</strong>
                  </span>
                  <span>&bull;</span>
                  <span>
                    CLIENT: <strong className="text-gray-100">{activeIncident.client}</strong>
                  </span>
                  <span>&bull;</span>
                  <span>
                    MODE: <strong className="text-gray-100">{activeIncident.mode}</strong>
                  </span>
                </div>
              </div>
            ) : (
              <div className="panel rounded-lg border border-gray-700 bg-gray-950 p-6 flex flex-col justify-center items-center text-center text-gray-500 min-h-[220px]">
                <span className="text-3xl mb-2 font-mono">🛡️</span>
                <div className="font-mono text-xs font-bold uppercase tracking-wider text-gray-100">
                  SAFETY GATE READY // STANDBY
                </div>
                <div className="text-xs text-gray-400 max-w-sm mt-1 leading-relaxed">
                  Select a fault scenario and launch a run. Any sensitive action requiring human approval will trigger an atomic pause here.
                </div>
              </div>
            )}
          </div>

          {/* Row 2: Verification Panel */}
          <div className="w-full">
            <VerificationPanel
              report={verificationReport}
              latestChecks={latestChecks}
              healthStatus={observedHealthStatus}
              finalOutcome={activeIncident?.outcome}
            />
          </div>

          {/* Row 3: Live Ops Governance Deck (Timeline / Action Lifecycle / Policy Explorer) */}
          <div className="w-full flex flex-col gap-2">
            <div className="flex items-center gap-1 border-b border-gray-800 pb-2">
              <button
                type="button"
                onClick={() => setOpsAuditTab('timeline')}
                className={`px-3 py-1.5 text-xs font-mono font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5 ${
                  opsAuditTab === 'timeline'
                    ? 'bg-[#1C1917] text-[#FAF6F0]'
                    : 'bg-transparent text-gray-400 hover:text-gray-200'
                }`}
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>Evidence & Audit Stream</span>
              </button>

              <button
                type="button"
                onClick={() => setOpsAuditTab('lifecycle')}
                className={`px-3 py-1.5 text-xs font-mono font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5 ${
                  opsAuditTab === 'lifecycle'
                    ? 'bg-[#1C1917] text-[#FAF6F0]'
                    : 'bg-transparent text-gray-400 hover:text-gray-200'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Action Lifecycle</span>
              </button>

              <button
                type="button"
                onClick={() => setOpsAuditTab('policy')}
                className={`px-3 py-1.5 text-xs font-mono font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5 ${
                  opsAuditTab === 'policy'
                    ? 'bg-[#1C1917] text-[#FAF6F0]'
                    : 'bg-transparent text-gray-400 hover:text-gray-200'
                }`}
              >
                <Shield className="w-3.5 h-3.5" />
                <span>Policy Gates</span>
              </button>
            </div>

            {opsAuditTab === 'timeline' && (
              <EventTimeline
                events={events}
                connectionStatus={connectionStatus}
                incidentId={activeIncidentId}
              />
            )}

            {opsAuditTab === 'lifecycle' && (
              <ActionLifecycleTimeline
                events={events}
                activeIncident={activeIncident}
              />
            )}

            {opsAuditTab === 'policy' && (
              <PolicyDecisionExplorer
                events={events}
                activeIncident={activeIncident}
              />
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 flex flex-col items-center w-full">
      {/* Sharp Architectural Header */}
      <Header
        activeView={activeView}
        onSelectView={handleSelectView}
        health={health}
        connectionStatus={connectionStatus}
        hasActiveIncident={Boolean(activeIncidentId)}
        onRefreshHistory={loadHistory}
        onOpenHistory={() => setIsHistoryOpen(true)}
        pendingApprovalsCount={pendingApprovalsCount}
      />

      {/* Main Content Area */}
      <main className="w-full max-w-7xl mx-auto px-6 py-6 flex-1">
        {viewContent}
      </main>

      {/* History Drawer */}
      <IncidentHistory
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        incidents={incidentsList}
        isLoading={isLoadingHistory}
        onSelectIncident={handleSelectHistoricalIncident}
        onRefresh={loadHistory}
        selectedIncidentId={activeIncidentId}
      />
    </div>
  );
};
