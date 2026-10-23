import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  CustomScenarioParams,
  Event,
  HealthResponse,
  IncidentResponse,
  IncidentSummaryItem,
  ScenariosResponse,
  VerificationCheck,
  VerificationReport,
} from './types';
import {
  fetchHealth,
  fetchIncident,
  fetchIncidents,
  fetchScenarios,
  startIncident,
  submitApproval,
  subscribeToEvents,
  SseSubscription,
  ApiError,
} from './api/client';
import { Header } from './components/Header';
import { ProofLoopHero } from './components/ProofLoopHero';
import { IncidentLauncher } from './components/IncidentLauncher';
import { ApprovalCard } from './components/ApprovalCard';
import { VerificationPanel } from './components/VerificationPanel';
import { EventTimeline } from './components/EventTimeline';
import { IncidentHistory } from './components/IncidentHistory';
import { BenchmarkView } from './components/BenchmarkView';

export const App: React.FC = () => {
  const [activeView, setActiveView] = useState<'operations' | 'benchmark'>('operations');
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

  const [pendingApprovalEvent, setPendingApprovalEvent] = useState<Event | null>(null);
  const [isSubmittingApproval, setIsSubmittingApproval] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const [latestChecks, setLatestChecks] = useState<VerificationCheck[]>([]);
  const [verificationReport, setVerificationReport] = useState<VerificationReport | null>(null);
  const [observedHealthStatus, setObservedHealthStatus] = useState<number | undefined>(undefined);

  const [incidentsList, setIncidentsList] = useState<IncidentSummaryItem[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const sseSubscriptionRef = useRef<SseSubscription | null>(null);
  const operationsAnchorRef = useRef<HTMLDivElement | null>(null);

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
    try {
      const list = await fetchIncidents(50);
      setIncidentsList(list);
    } catch (err: any) {
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

  // Process incoming event to update UI states
  const handleIncomingEvent = useCallback((event: Event) => {
    setEvents((prev) => {
      if (prev.some((e) => e.event_id === event.event_id || (e.sequence && e.sequence === event.sequence))) {
        return prev;
      }
      return [...prev, event];
    });

    if (event.type === 'approval_requested') {
      setPendingApprovalEvent(event);
    } else if (
      event.type === 'human_approval_decision' ||
      event.type === 'approval_rejected_by_policy' ||
      event.type === 'outcome'
    ) {
      setPendingApprovalEvent(null);
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

    if (event.type === 'outcome') {
      setActiveIncident((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          outcome: event.payload?.outcome || prev.outcome,
          summary: event.payload?.summary || prev.summary,
        };
      });
      loadHistory();
    }
  }, [loadHistory]);

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
          onError: () => {},
        },
        0
      );
    } catch (err: any) {
      setLaunchError(err.message || 'Failed to start incident simulation');
      setConnectionStatus('disconnected');
    } finally {
      setIsLaunching(false);
    }
  };

  // Submit human approval decision
  const handleSubmitApproval = async (decision: 'approve' | 'deny', approverId: string, comment: string) => {
    if (!activeIncidentId) return;
    setIsSubmittingApproval(true);
    setApprovalError(null);

    try {
      const updated = await submitApproval(activeIncidentId, {
        decision,
        approver_id: approverId,
        comment,
      });

      setPendingApprovalEvent(null);
      setActiveIncident(updated);
      loadHistory();
    } catch (err: any) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setApprovalError('Conflict: This approval request has already been processed or resolved.');
        } else if (err.status === 404) {
          setApprovalError('Not Found: Pending approval record does not exist on server.');
        } else if (err.status === 422) {
          setApprovalError(`Validation Error: ${err.detail}`);
        } else {
          setApprovalError(err.detail || err.message);
        }
      } else {
        setApprovalError(err.message || 'Approval submission failed');
      }
    } finally {
      setIsSubmittingApproval(false);
    }
  };

  // Replay a historical incident
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

    try {
      const res = await fetchIncident(incidentId);
      setActiveIncidentId(res.incident_id);
      setActiveIncident(res);
      setEvents(res.events || []);

      const checks: VerificationCheck[] = [];
      res.events.forEach((ev) => {
        if (ev.type === 'approval_requested' && res.outcome === 'PENDING_APPROVAL') {
          setPendingApprovalEvent(ev);
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

      if (res.outcome === 'PENDING_APPROVAL' || res.outcome === 'RUNNING') {
        const lastSequence = res.events.reduce((max, ev) => Math.max(max, ev.sequence ?? 0), 0);
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

  const handleSelectView = (view: 'operations' | 'benchmark') => {
    setActiveView(view);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const scrollToOperations = () => {
    setActiveView('operations');
    setTimeout(() => {
      operationsAnchorRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  };

  return (
    <div className="min-h-screen bg-[#F4EFEB] flex flex-col items-center w-full text-[#1C1917]">
      {/* Sharp Architectural Header */}
      <Header
        health={health}
        connectionStatus={connectionStatus}
        hasActiveIncident={Boolean(activeIncidentId)}
        onRefreshHistory={loadHistory}
        onOpenHistory={() => setIsHistoryOpen(true)}
        activeView={activeView}
        onSelectView={handleSelectView}
      />

      {activeView === 'operations' ? (
        <>
          {/* Hero Section with 12-Column Grid Lines and Sliding Arrow Button */}
          <ProofLoopHero
            activeView={activeView}
            onStartClick={scrollToOperations}
            onBenchmarkClick={() => handleSelectView('benchmark')}
          />

          {/* Main Workspace: Sharp Layout */}
          <div ref={operationsAnchorRef} className="w-full flex justify-center">
            <main className="w-full max-w-5xl mx-auto px-6 py-10 flex flex-col gap-8">
            {/* Command Deck Header - Centered */}
            <div className="flex flex-col sm:flex-row items-center justify-between border-b border-[#DFD7C7] pb-3.5 gap-2 text-center sm:text-left">
              <div className="flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 bg-[#0E7490]"></span>
                <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-[#1C1917]">
                  AGENTOPS INCIDENT COMMAND DECK
                </h2>
              </div>
              <span className="text-[11px] font-mono text-[#6B6255]">
                ACTIVE CLIENT POLICY: STANDARD ENFORCEMENT
              </span>
            </div>

            {/* Row 1: Launcher & Approval/Active State - Evenly Spaced */}
            <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
              {/* Incident Launcher */}
              <IncidentLauncher
                scenariosData={scenariosData}
                isLoadingScenarios={isLoadingScenarios}
                onLaunch={handleLaunchIncident}
                isLaunching={isLaunching}
                error={launchError}
              />

              {/* Right Column: Pending Approval Card OR Active Incident Status */}
              <div className="flex flex-col gap-4">
                {pendingApprovalEvent && activeIncidentId ? (
                  <ApprovalCard
                    incidentId={activeIncidentId}
                    pendingEvent={pendingApprovalEvent}
                    onSubmitApproval={handleSubmitApproval}
                    isSubmitting={isSubmittingApproval}
                    approvalError={approvalError}
                  />
                ) : activeIncident ? (
                  <div className="panel border border-[#DFD7C7] bg-[#FAF6F0]">
                    <div className="panel-header">
                      <span className="panel-title font-mono text-xs">
                        <span>📌</span>
                        <span>Active Run: <span className="font-mono text-[#0E7490]">{activeIncident.incident_id.slice(0, 8)}...</span></span>
                      </span>
                      <span
                        className={`badge font-mono text-xs ${
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
                    </div>
                    <div className="text-xs text-[#575044] font-sans leading-relaxed">
                      {activeIncident.summary}
                    </div>
                    <div className="flex gap-4 text-xs font-mono text-[#6B6255] border-t border-[#DFD7C7] pt-2">
                      <span>SCENARIO: <strong className="text-[#1C1917]">{activeIncident.scenario}</strong></span>
                      <span>&bull;</span>
                      <span>CLIENT: <strong className="text-[#1C1917]">{activeIncident.client}</strong></span>
                      <span>&bull;</span>
                      <span>MODE: <strong className="text-[#1C1917]">{activeIncident.mode}</strong></span>
                    </div>
                  </div>
                ) : (
                  <div className="panel border border-[#DFD7C7] bg-[#FAF6F0] p-6 flex flex-col justify-center items-center text-center text-[#6B6255] min-h-[220px]">
                    <span className="text-2xl mb-2 font-mono">🛡️</span>
                    <div className="font-mono text-xs font-bold uppercase tracking-wider text-[#1C1917]">
                      SAFETY GATE READY // STANDBY
                    </div>
                    <div className="text-xs text-[#6B6255] max-w-sm mt-1 leading-relaxed">
                      Select a fault scenario and launch a run. Any sensitive action requiring human approval will trigger an atomic pause here.
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Row 2: Verification Panel - Full Width Matrix */}
            <div className="w-full">
              <VerificationPanel
                report={verificationReport}
                latestChecks={latestChecks}
                healthStatus={observedHealthStatus}
                finalOutcome={activeIncident?.outcome}
              />
            </div>

            {/* Row 3: Event Stream - Full Width Monospace Terminal */}
            <div className="w-full">
              <EventTimeline
                events={events}
                connectionStatus={connectionStatus}
                incidentId={activeIncidentId}
              />
            </div>
          </main>
        </div>
      </>
    ) : (
      <div ref={operationsAnchorRef} className="w-full flex justify-center py-6">
        <main className="w-full flex justify-center">
          <BenchmarkView
            availableScenarios={scenariosData?.scenarios}
            availableClients={scenariosData?.clients}
          />
        </main>
      </div>
    )}

      {/* History Drawer / Modal */}
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
