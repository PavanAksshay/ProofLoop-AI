import { InvestigationState, ServiceTopologyGraph, ServiceTopologyNode, ServiceTopologyLink, ProvenanceKind } from '../types';

/**
 * Synthesizes a deterministic Service Topology Graph from observed incident telemetry,
 * diagnostic tool records, remediation targets, and verified invariant checks.
 *
 * Integrity rules:
 * - Only nodes with direct evidence, diagnostic execution, or remediation targeting are included.
 * - No standard/default topology nodes are added unconditionally.
 * - A successful diagnostic call does NOT imply service health — status stays 'unknown'
 *   unless an error occurred (degraded) or independent verification passed (healthy).
 * - All inter-service links are provenance:'inferred' with protocol:null.
 * - node.provenance is 'observed' when direct evidence or diagnostics exist, 'inferred' otherwise.
 * - hasSufficientTelemetry is true when at least one node was built from real telemetry.
 */
export function inferServiceTopology(
  investigation: InvestigationState | null,
  incidentId: string
): ServiceTopologyGraph {
  if (!investigation) {
    return {
      nodes: [],
      links: [],
      sourceIncidentId: incidentId,
      hasSufficientTelemetry: false,
      unavailableReason: 'No investigation data available for this incident.',
    };
  }

  const nodeMap = new Map<string, ServiceTopologyNode>();

  const getOrCreateNode = (
    id: string,
    name: string,
    type: ServiceTopologyNode['type'],
    provenance: ProvenanceKind
  ): ServiceTopologyNode => {
    let node = nodeMap.get(id);
    if (!node) {
      node = {
        id,
        name,
        type,
        status: 'unknown',
        provenance,
        statusRationale: 'No direct health observation recorded.',
        evidenceRefs: [],
        diagnosticsRun: [],
      };
      nodeMap.set(id, node);
    }
    return node;
  };

  // 1. Ingest diagnostics performed
  // A diagnostic execution is direct observation of the service being probed.
  // Success means the probe ran without error — it does NOT mean the service is healthy.
  for (const diag of investigation.diagnostics_performed || []) {
    const serviceName = diag.service || 'core-service';
    const type: ServiceTopologyNode['type'] = serviceName.includes('database') || serviceName.includes('db')
      ? 'database'
      : serviceName.includes('gateway')
      ? 'gateway'
      : serviceName.includes('config')
      ? 'config'
      : 'service';

    const node = getOrCreateNode(serviceName, serviceName, type, 'observed');
    node.diagnosticsRun.push(diag.tool);

    if (!diag.success || diag.error) {
      node.status = 'degraded';
      node.statusRationale = `Diagnostic tool '${diag.tool}' reported error: ${diag.error || 'unknown error'}.`;
    } else {
      // Probe ran without error — this tells us the probe succeeded, NOT that the service is healthy.
      // Status stays 'unknown' unless later overridden by verification evidence.
      if (node.status === 'unknown') {
        node.statusRationale = `Diagnostic tool '${diag.tool}' executed without error. Health not independently verified.`;
      }
    }
  }

  // 2. Ingest evidence items
  // Evidence from a named source is treated as 'observed' provenance for that service.
  for (const ev of investigation.evidence || []) {
    const src = ev.source || '';
    let serviceId: string | null = null;

    if (src.includes('checkout')) serviceId = 'checkout-service';
    else if (src.includes('db') || src.includes('database') || src.includes('postgres')) serviceId = 'database';
    else if (src.includes('auth')) serviceId = 'auth-service';
    else if (src.includes('gateway')) serviceId = 'edge-gateway';
    else if (src.includes('config')) serviceId = 'config-store';
    // If source doesn't match a recognizable service pattern, skip rather than invent 'core-service'
    if (!serviceId) continue;

    const type: ServiceTopologyNode['type'] = serviceId === 'database'
      ? 'database'
      : serviceId === 'edge-gateway'
      ? 'gateway'
      : serviceId === 'config-store'
      ? 'config'
      : 'service';

    const node = getOrCreateNode(serviceId, serviceId, type, 'observed');
    if (!node.evidenceRefs.includes(ev.id)) {
      node.evidenceRefs.push(ev.id);
    }

    if (ev.kind === 'contradictory' || ev.summary?.toLowerCase().includes('error')) {
      if (node.status !== 'failed') {
        node.status = 'degraded';
        node.statusRationale = `Evidence '${ev.id}' indicates error condition: "${ev.summary}".`;
      }
    }
  }

  // 3. Ingest remediation history & invariant checks
  // Only verification_passed === true from an independent verifier is treated as confirmed health.
  for (const rem of investigation.remediation_history || []) {
    const serviceName = rem.service;
    if (!serviceName) continue;

    const node = getOrCreateNode(serviceName, serviceName, 'service', 'observed');
    node.isRemediationTarget = true;

    if (rem.verification_passed === true) {
      // Independent verifier confirmed recovery — this is a strong health signal.
      node.status = 'healthy';
      node.provenance = 'observed';
      node.statusRationale = 'Independent recovery verifier confirmed service health post-remediation.';
    } else if (rem.verification_passed === false) {
      node.status = 'failed';
      node.statusRationale = 'Independent recovery verifier confirmed remediation did NOT restore service health.';
    }
  }

  // 4. Mark suspected root-cause from leading hypothesis
  const leadingHypId = investigation.current_diagnosis?.leading_hypothesis_id;
  if (leadingHypId) {
    const leadingHyp = investigation.hypotheses?.find((h) => h.id === leadingHypId);
    if (leadingHyp) {
      const cat = leadingHyp.category?.toLowerCase() || '';
      for (const [id, node] of nodeMap.entries()) {
        if (
          (cat.includes('database') && id === 'database') ||
          (cat.includes('config') && (id === 'config-store' || id === 'checkout-service')) ||
          (cat.includes('auth') && id === 'auth-service') ||
          (cat.includes('checkout') && id === 'checkout-service')
        ) {
          node.isSuspectedRootCause = true;
        }
      }
    }
  }

  // 5. Build inferred dependency links between co-occurring nodes
  // All links are inferred from co-occurrence, not directly observed.
  // Protocol is null because we have no ground-truth protocol information.
  const links: ServiceTopologyLink[] = [];
  const inferredLinkRationale = 'Inferred from co-occurrence in telemetry — not directly observed.';

  if (nodeMap.has('edge-gateway') && nodeMap.has('checkout-service')) {
    links.push({
      source: 'edge-gateway',
      target: 'checkout-service',
      provenance: 'inferred',
      protocol: null,
      healthy: nodeMap.get('checkout-service')?.status !== 'failed',
      rationale: inferredLinkRationale,
    });
  }
  if (nodeMap.has('checkout-service') && nodeMap.has('database')) {
    links.push({
      source: 'checkout-service',
      target: 'database',
      provenance: 'inferred',
      protocol: null,
      healthy: nodeMap.get('database')?.status !== 'failed',
      rationale: inferredLinkRationale,
    });
  }
  if (nodeMap.has('checkout-service') && nodeMap.has('config-store')) {
    links.push({
      source: 'checkout-service',
      target: 'config-store',
      provenance: 'inferred',
      protocol: null,
      healthy: nodeMap.get('config-store')?.status !== 'failed',
      rationale: inferredLinkRationale,
    });
  }
  if (nodeMap.has('edge-gateway') && nodeMap.has('auth-service')) {
    links.push({
      source: 'edge-gateway',
      target: 'auth-service',
      provenance: 'inferred',
      protocol: null,
      healthy: nodeMap.get('auth-service')?.status !== 'failed',
      rationale: inferredLinkRationale,
    });
  }
  if (nodeMap.has('auth-service') && nodeMap.has('database')) {
    links.push({
      source: 'auth-service',
      target: 'database',
      provenance: 'inferred',
      protocol: null,
      healthy: nodeMap.get('database')?.status !== 'failed',
      rationale: inferredLinkRationale,
    });
  }

  const hasSufficientTelemetry = nodeMap.size > 0;

  return {
    nodes: Array.from(nodeMap.values()),
    links,
    inferredAt: new Date().toISOString(),
    sourceIncidentId: incidentId,
    hasSufficientTelemetry,
    unavailableReason: hasSufficientTelemetry
      ? undefined
      : 'No diagnostic, evidence, or remediation telemetry found for this incident.',
  };
}
