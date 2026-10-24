import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  IncidentResponse,
  Event,
  InvestigationState,
} from '../../types';
import { AgentNodeId } from '../../types/agent-engine';
import { deriveNormalizedEngineState } from '../../lib/agentEngineAdapter';
import { AgentScene3D } from './AgentScene3D';
import { AgentFallback2D } from './AgentFallback2D';
import { AgentStatusRail } from './AgentStatusRail';
import { AgentDetailsPanel } from './AgentDetailsPanel';
import { AgentTelemetryArea } from './AgentTelemetryArea';
import { AgentEventTimeline } from './AgentEventTimeline';
import {
  Boxes,
  Maximize2,
  Minimize2,
  Layers,
  Box,
  Play,
  Pause,
  RotateCcw,
  SkipForward,
} from 'lucide-react';

interface AgentOperationsEngineProps {
  activeIncident: IncidentResponse | null;
  events: Event[];
  investigationState: InvestigationState | null;
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'completed';
  isCompact?: boolean;
  onToggleCompact?: () => void;
  className?: string;
}

export type PlaybackSpeed = '1x' | '2x' | 'instant';

export const AgentOperationsEngine: React.FC<AgentOperationsEngineProps> = ({
  activeIncident,
  events,
  investigationState,
  connectionStatus,
  isCompact = false,
  onToggleCompact,
  className = '',
}) => {
  // Pacing Engine State: Controls the gradual, visual progression of incident events
  const [displayedCount, setDisplayedCount] = useState<number>(() => events.length);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>('1x');
  const [isPaused, setIsPaused] = useState<boolean>(false);

  const prevIncidentIdRef = useRef<string | null>(activeIncident?.incident_id || null);
  const prevEventsLengthRef = useRef<number>(events.length);

  // Detect when incident starts fresh, restarts, or switches
  useEffect(() => {
    const currentId = activeIncident?.incident_id || null;
    const isNewIncident = currentId !== prevIncidentIdRef.current;
    const isEventReset = events.length === 0 && prevEventsLengthRef.current > 0;
    const isNewBatch = events.length > 0 && prevEventsLengthRef.current === 0;

    if (isNewIncident || isEventReset) {
      prevIncidentIdRef.current = currentId;
      prevEventsLengthRef.current = events.length;
      if (events.length > 0) {
        // Start from step 1 for gradual playback
        setDisplayedCount(1);
        setIsPaused(false);
      } else {
        setDisplayedCount(0);
      }
      return;
    }

    if (isNewBatch) {
      // First events arrived for an active incident
      setDisplayedCount(1);
      setIsPaused(false);
      prevEventsLengthRef.current = events.length;
      return;
    }

    // If speed is instant, always keep up with latest events
    if (playbackSpeed === 'instant') {
      setDisplayedCount(events.length);
    }

    prevEventsLengthRef.current = events.length;
  }, [activeIncident?.incident_id, events.length, playbackSpeed]);

  // Gradual event step advancement timer
  useEffect(() => {
    if (isPaused || playbackSpeed === 'instant') return;
    if (displayedCount >= events.length) return;

    const delayMs = playbackSpeed === '2x' ? 550 : 1300;

    const timer = setTimeout(() => {
      setDisplayedCount((current) => {
        const next = Math.min(current + 1, events.length);
        // Smart pause: if the newly revealed event is an approval request, hold playback for operator
        const currentEvent = events[next - 1];
        if (currentEvent && currentEvent.type === 'approval_requested') {
          setIsPaused(true);
        }
        return next;
      });
    }, delayMs);

    return () => clearTimeout(timer);
  }, [displayedCount, events, isPaused, playbackSpeed]);

  // Displayed events slice for the visual engine & timeline
  const displayedEvents = useMemo(() => {
    if (playbackSpeed === 'instant' || displayedCount >= events.length) {
      return events;
    }
    return events.slice(0, displayedCount);
  }, [events, displayedCount, playbackSpeed]);

  // Authoritative incident snapshot adjusted for progressive event reveal
  const currentIncidentSnapshot = useMemo(() => {
    if (!activeIncident) return null;

    const hasOutcomeEvent = displayedEvents.some((e) => e.type === 'outcome');
    const outcomeEvent = displayedEvents.find((e) => e.type === 'outcome');

    // While pacing through events, do not jump ahead to terminal VERIFIED state
    // until the actual outcome event has been reached in displayedEvents!
    const isStillAdvancing = events.length > 0 && displayedCount < events.length;
    const effectiveOutcome = hasOutcomeEvent
      ? (outcomeEvent?.payload?.outcome || activeIncident.outcome)
      : isStillAdvancing
      ? 'RUNNING'
      : activeIncident.outcome;

    return {
      ...activeIncident,
      outcome: effectiveOutcome,
    };
  }, [activeIncident, displayedEvents, events.length, displayedCount]);

  // Normalize engine state according to currently revealed events
  const normalizedState = useMemo(() => {
    return deriveNormalizedEngineState(
      currentIncidentSnapshot,
      displayedEvents,
      investigationState,
      connectionStatus
    );
  }, [currentIncidentSnapshot, displayedEvents, investigationState, connectionStatus]);

  // View state
  const [use3D, setUse3D] = useState<boolean>(true);
  const [selectedNodeId, setSelectedNodeId] = useState<AgentNodeId | null>(null);
  const [localCompact, setLocalCompact] = useState<boolean>(isCompact);

  const effectiveCompact = onToggleCompact ? isCompact : localCompact;
  const toggleCompactMode = onToggleCompact || (() => setLocalCompact((prev) => !prev));

  const handleSelectNode = useCallback((nodeId: AgentNodeId) => {
    setSelectedNodeId((current) => (current === nodeId ? null : nodeId));
  }, []);

  const handleCloseDetails = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  // Pacing Controls Handlers
  const handleTogglePlayPause = useCallback(() => {
    setIsPaused((prev) => !prev);
  }, []);

  const handleSkipToEnd = useCallback(() => {
    setDisplayedCount(events.length);
    setIsPaused(false);
  }, [events.length]);

  const handleReplay = useCallback(() => {
    setDisplayedCount(events.length > 0 ? 1 : 0);
    setIsPaused(false);
  }, [events.length]);

  const handleCycleSpeed = useCallback(() => {
    setPlaybackSpeed((current) => {
      if (current === '1x') return '2x';
      if (current === '2x') return 'instant';
      return '1x';
    });
  }, []);

  const selectedNode = selectedNodeId ? normalizedState.nodes[selectedNodeId] : null;
  const isPacingActive = events.length > 0 && displayedCount < events.length;

  return (
    <section
      className={`bg-[#FAF6F0] border border-[#DFD7C7] rounded-lg overflow-hidden flex flex-col font-mono text-[#1C1917] shadow-sm ${className}`}
      aria-label="Agent Operations Engine"
    >
      {/* Control Surface Top Bar */}
      <div className="bg-[#ECE6DC] border-b border-[#DFD7C7] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        {/* Title & Brand */}
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded bg-[#FAF6F0] border border-[#DFD7C7] flex items-center justify-center text-[#1C1917]">
            <Boxes className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#1C1917]">
                PROOFLOOP // 3D AGENT OPERATIONS ENGINE
              </h2>
              <span className="px-1.5 py-0.5 text-[9px] rounded font-bold uppercase border border-[#DFD7C7] bg-[#FFFFFF] text-[#0D9488]">
                LIVE 3D
              </span>
            </div>
            <p className="text-[10px] text-[#6B6255] hidden sm:block">
              Multi-Agent Invariant Coordination & Runtime Pipeline
            </p>
          </div>
        </div>

        {/* Center / Right: Pacing Controls & Mode Toggles */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Active Incident Pill */}
          {activeIncident ? (
            <div className="flex items-center gap-2 bg-[#FFFFFF] px-2.5 py-1 rounded border border-[#DFD7C7] text-[11px] shadow-xs">
              <span className="text-[#6B6255] text-[10px]">INCIDENT:</span>
              <span className="font-bold text-[#1C1917] truncate max-w-[120px]">
                {activeIncident.incident_id}
              </span>
              <span className="text-[#DFD7C7]">|</span>
              <span className="text-[#0D9488] font-semibold uppercase text-[10px]">
                {activeIncident.scenario}
              </span>
            </div>
          ) : (
            <div className="bg-[#FFFFFF] px-2.5 py-1 rounded border border-[#DFD7C7] text-[10px] text-[#6B6255]">
              STANDBY (READY)
            </div>
          )}

          {/* Pacing Speed & Replay Controls */}
          {events.length > 0 && (
            <div className="flex items-center gap-1 bg-[#FFFFFF] p-0.5 rounded border border-[#DFD7C7] text-[10px] shadow-xs">
              {/* Play / Pause Toggle */}
              <button
                type="button"
                onClick={handleTogglePlayPause}
                className={`p-1 rounded transition-colors flex items-center gap-1 ${
                  isPaused
                    ? 'bg-amber-100 text-amber-900 border border-amber-300 font-bold'
                    : 'text-[#6B6255] hover:text-[#1C1917]'
                }`}
                title={isPaused ? 'Resume gradual execution' : 'Pause gradual execution'}
                aria-label={isPaused ? 'Resume gradual execution' : 'Pause gradual execution'}
              >
                {isPaused ? <Play className="w-3 h-3 fill-current" /> : <Pause className="w-3 h-3 fill-current" />}
              </button>

              {/* Speed Selector */}
              <button
                type="button"
                onClick={handleCycleSpeed}
                className="px-1.5 py-0.5 rounded font-bold text-[9px] text-[#1C1917] hover:bg-[#ECE6DC] transition-colors border border-transparent hover:border-[#DFD7C7]"
                title="Cycle progression speed (1x -> 2x -> Instant)"
              >
                {playbackSpeed.toUpperCase()}
              </button>

              {/* Progress Step Counter */}
              <span className="text-[9px] text-[#6B6255] px-1 font-semibold">
                {displayedCount}/{events.length}
              </span>

              {/* Skip to End Button */}
              {isPacingActive && (
                <button
                  type="button"
                  onClick={handleSkipToEnd}
                  className="px-1.5 py-0.5 rounded text-[9px] font-bold text-[#0D9488] hover:bg-teal-50 border border-transparent hover:border-teal-200 transition-colors flex items-center gap-0.5"
                  title="Fast-forward directly to final verified state"
                >
                  <SkipForward className="w-2.5 h-2.5" />
                  <span>SKIP</span>
                </button>
              )}

              {/* Replay Button */}
              {!isPacingActive && (
                <button
                  type="button"
                  onClick={handleReplay}
                  className="px-1.5 py-0.5 rounded text-[9px] font-bold text-[#1C1917] hover:bg-[#ECE6DC] border border-transparent hover:border-[#DFD7C7] transition-colors flex items-center gap-0.5"
                  title="Replay execution slowly from beginning"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  <span>REPLAY</span>
                </button>
              )}
            </div>
          )}

          {/* 3D vs 2D Fallback Toggle */}
          <div className="flex items-center rounded border border-[#DFD7C7] bg-[#FFFFFF] p-0.5 text-[10px] shadow-xs">
            <button
              type="button"
              onClick={() => setUse3D(true)}
              className={`px-2 py-0.5 rounded transition-colors flex items-center gap-1 ${
                use3D
                  ? 'bg-[#18181B] text-[#FFFFFF] font-bold shadow-xs'
                  : 'text-[#6B6255] hover:text-[#1C1917]'
              }`}
              title="Render interactive 3D WebGL scene with sleek black orbs"
            >
              <Box className="w-3 h-3" />
              <span>3D</span>
            </button>
            <button
              type="button"
              onClick={() => setUse3D(false)}
              className={`px-2 py-0.5 rounded transition-colors flex items-center gap-1 ${
                !use3D
                  ? 'bg-[#18181B] text-[#FFFFFF] font-bold shadow-xs'
                  : 'text-[#6B6255] hover:text-[#1C1917]'
              }`}
              title="Render accessible 2D vector topology"
            >
              <Layers className="w-3 h-3" />
              <span>2D</span>
            </button>
          </div>

          {/* Compact / Expanded Toggle */}
          <button
            type="button"
            onClick={toggleCompactMode}
            className="p-1.5 rounded border border-[#DFD7C7] bg-[#FFFFFF] text-[#6B6255] hover:text-[#1C1917] hover:border-[#1C1917]/30 transition-colors shadow-xs"
            title={effectiveCompact ? 'Expand visual canvas' : 'Compact visual canvas'}
            aria-label={effectiveCompact ? 'Expand visual canvas' : 'Compact visual canvas'}
          >
            {effectiveCompact ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Main Visual Arena & Side Rail */}
      <div className="p-3 grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
        {/* Visual Engine Stage (3D Canvas or 2D Vector) */}
        <div
          className={`${
            effectiveCompact ? 'lg:col-span-8' : 'lg:col-span-8'
          } flex flex-col gap-3 min-w-0`}
        >
          <div
            className={`w-full rounded border border-[#DFD7C7] overflow-hidden bg-[#F5EFEB] relative transition-all duration-300 ${
              effectiveCompact ? 'h-[440px]' : 'h-[540px]'
            }`}
          >
            {use3D ? (
              <AgentScene3D
                state={normalizedState}
                selectedNodeId={selectedNodeId}
                onSelectNode={handleSelectNode}
                onWebGLError={() => setUse3D(false)}
                className="w-full h-full"
              />
            ) : (
              <AgentFallback2D
                state={normalizedState}
                selectedNodeId={selectedNodeId}
                onSelectNode={handleSelectNode}
                className="w-full h-full"
              />
            )}
          </div>

          {/* Operational Telemetry Strip */}
          <AgentTelemetryArea telemetry={normalizedState.telemetry} />
        </div>

        {/* Side Rail & Inspection Stack */}
        <div className="lg:col-span-4 flex flex-col gap-3 min-w-0">
          {/* Agent Status Rail */}
          <AgentStatusRail
            nodes={normalizedState.nodes}
            selectedNodeId={selectedNodeId}
            onSelectNode={handleSelectNode}
          />

          {/* Selected Node Details Drawer */}
          {selectedNodeId && (
            <AgentDetailsPanel
              nodeId={selectedNodeId}
              node={selectedNode}
              telemetry={normalizedState.telemetry}
              onClose={handleCloseDetails}
            />
          )}

          {/* Live Event Stream */}
          <AgentEventTimeline
            events={displayedEvents}
            connectionStatus={connectionStatus}
            onSelectNodeByActor={handleSelectNode}
          />
        </div>
      </div>
    </section>
  );
};
