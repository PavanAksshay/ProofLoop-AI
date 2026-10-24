import { IncidentSummaryItem, IncidentAnalyticsSummary, Outcome } from '../types';

/**
 * Computes transparent, deterministic incident analytics from real operational records.
 * Treat missing or unrecorded fields as unavailable, never fabricated.
 */
export function computeIncidentAnalytics(incidents: IncidentSummaryItem[]): IncidentAnalyticsSummary {
  const totalIncidents = incidents.length;
  let verifiedRecoveries = 0;
  let unverifiedOrFailed = 0;
  let escalatedCount = 0;
  let pendingApprovals = 0;
  let runningCount = 0;

  const scenarioBreakdown: Record<string, { total: number; verified: number; escalated: number; failed: number }> = {};
  const clientBreakdown: Record<string, number> = {};
  const outcomeBreakdown: Record<Outcome, number> = {
    VERIFIED: 0,
    UNVERIFIED: 0,
    BLOCKED: 0,
    ESCALATED: 0,
    PENDING_APPROVAL: 0,
    RUNNING: 0,
  };

  const durationsMs: number[] = [];
  const recentTimeline: Array<{ incident_id: string; scenario: string; outcome: Outcome; timestamp: string }> = [];

  for (const inc of incidents) {
    const outcome = inc.outcome;
    if (outcomeBreakdown[outcome] !== undefined) {
      outcomeBreakdown[outcome]++;
    }

    if (outcome === 'VERIFIED') {
      verifiedRecoveries++;
    } else if (outcome === 'ESCALATED') {
      escalatedCount++;
    } else if (outcome === 'PENDING_APPROVAL') {
      pendingApprovals++;
    } else if (outcome === 'RUNNING') {
      runningCount++;
    } else {
      unverifiedOrFailed++;
    }

    // Scenario breakdown
    const scenario = inc.scenario || 'unknown';
    if (!scenarioBreakdown[scenario]) {
      scenarioBreakdown[scenario] = { total: 0, verified: 0, escalated: 0, failed: 0 };
    }
    scenarioBreakdown[scenario].total++;
    if (outcome === 'VERIFIED') {
      scenarioBreakdown[scenario].verified++;
    } else if (outcome === 'ESCALATED') {
      scenarioBreakdown[scenario].escalated++;
    } else if (outcome === 'BLOCKED' || outcome === 'UNVERIFIED') {
      scenarioBreakdown[scenario].failed++;
    }

    // Client breakdown
    const client = inc.client || 'unknown';
    clientBreakdown[client] = (clientBreakdown[client] || 0) + 1;

    // MTTR calculation for verified incidents with valid distinct timestamps
    if (outcome === 'VERIFIED' && inc.created_at && inc.updated_at) {
      const created = new Date(inc.created_at).getTime();
      const updated = new Date(inc.updated_at).getTime();
      if (!isNaN(created) && !isNaN(updated) && updated > created) {
        durationsMs.push(updated - created);
      }
    }

    // Timeline item
    recentTimeline.push({
      incident_id: inc.incident_id,
      scenario: inc.scenario,
      outcome: inc.outcome,
      timestamp: inc.updated_at || inc.created_at || new Date().toISOString(),
    });
  }

  // Mean time to verified recovery
  const meanTimeToRecoveryMs =
    durationsMs.length > 0
      ? durationsMs.reduce((acc, curr) => acc + curr, 0) / durationsMs.length
      : null;

  const verifiedRecoveryRate = totalIncidents > 0 ? verifiedRecoveries / totalIncidents : 0;

  // MTTR explanation
  const recoveryDurationExplanation =
    durationsMs.length > 0
      ? `Computed from ${durationsMs.length} VERIFIED incident(s) with valid created_at→updated_at durations where updated_at > created_at.`
      : 'No VERIFIED incidents with valid distinct timestamps found in current sample.';

  return {
    totalIncidents,
    verifiedRecoveries,
    unverifiedOrFailed,
    escalatedCount,
    pendingApprovals,
    runningCount,
    verifiedRecoveryRate,
    // falseSuccessRate cannot be computed from IncidentSummaryItem[] alone.
    // Requires per-incident verification check records from GET /incidents/{id}/investigation
    // (remediation_history[].verification_checks), which are not exposed in the aggregate history endpoint.
    falseSuccessRate: null,
    falseSuccessExplanation:
      'Cannot be computed from incident summary list. Requires per-incident verification check records ' +
      '(GET /incidents/{id}/investigation → remediation_history[].verification_checks) ' +
      'not available in the GET /incidents aggregate response.',
    // policyViolationRate cannot be computed from IncidentSummaryItem[] alone.
    // Requires policy decision event records from the SSE event stream, not the summary list.
    policyViolationRate: null,
    policyViolationExplanation:
      'Cannot be computed from incident summary list. Requires policy decision event records ' +
      'from the SSE event stream (action_proposed / policy_decision events), ' +
      'not exposed in the GET /incidents aggregate response.',
    meanTimeToRecoveryMs,
    recoveryDurationExplanation,
    scenarioBreakdown,
    clientBreakdown,
    outcomeBreakdown,
    recentTimeline: recentTimeline.slice(0, 15),
  };
}
