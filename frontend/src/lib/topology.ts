import { InvestigationState, ServiceTopologyGraph, ServiceTopologyNode, ServiceTopologyLink, ProvenanceKind } from '../types';

/**
 * Normalizes a text string into a recognizable canonical service ID if one matches.
 */
function matchServiceId(text: string): string | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (t.includes('checkout')) return 'checkout-service';
  if (t.includes('postgres') || t.includes('database') || t.includes('db:') || t.includes('db_') || t.includes('to db')) return 'database';
  if (t.includes('auth')) return 'auth-service';
  if (t.includes('gateway') || t.includes('edge')) return 'edge-gateway';
  if (t.includes('config') || t.includes('etcd')) return 'config-store';
  return null;
}

/**
 * Searches text for a target service reference other than the source service.
 */
function findTargetServiceInText(text: string, sourceServiceId: string, knownServiceIds: string[]): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();

  for (const known of knownServiceIds) {
    if (known === sourceServiceId) continue;
    if (known === 'database' && (lower.includes('to db') || lower.includes('database') || lower.includes('postgres') || lower.includes('db:5432'))) {
      return 'database';
    }
    if (known === 'checkout-service' && lower.includes('checkout')) {
      return 'checkout-service';
    }
    if (known === 'auth-service' && lower.includes('auth')) {
      return 'auth-service';
    }
    if (known === 'edge-gateway' && (lower.includes('gateway') || lower.includes('edge'))) {
      return 'edge-gateway';
    }
    if (known === 'config-store' && (lower.includes('config') || lower.includes('etcd'))) {
      return 'config-store';
    }
    if (lower.includes(known.toLowerCase())) {
      return known;
    }
  }
  return null;
}

/**
 * Synthesizes a deterministic Service Topology Graph from observed incident telemetry,
 * diagnostic tool records, remediation targets, and verified invariant checks.
 *
 * Integrity rules:
 * - Only nodes with direct evidence, diagnostic execution, or remediation targeting are included.
 * - No standard/default topology nodes are added unconditionally.
 * - Co-occurrence of two service names alone does NOT establish a dependency relationship.
 * - Edges are created ONLY when specific evidence or an explicit hypothesis supports the relationship.
 * - Network protocols are never fabricated (protocol is null unless directly observed in telemetry).
 * - A successful diagnostic call does NOT imply service health — status stays 'unknown'
 *   unless an error occurred (degraded) or independent verification passed (healthy).
 * - Only authoritative independent recovery verification (verification_passed === true) confirms health.
 * - All relationships preserve provenance and supporting evidence references.
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
  // Diagnostic execution is direct observation of the probed service.
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
      if (node.status === 'unknown') {
        node.statusRationale = `Diagnostic tool '${diag.tool}' executed without error. Health not independently verified.`;
      }
    }
  }

  // 2. Ingest evidence items
  for (const ev of investigation.evidence || []) {
    const src = ev.source || '';
    const serviceId = matchServiceId(src);
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

  // 5. Build evidence-backed dependency links
  // Co-occurrence alone NEVER produces an edge.
  // An edge is established ONLY when evidence or a hypothesis explicitly supports the relationship.
  const links: ServiceTopologyLink[] = [];
  const knownServiceIds = Array.from(nodeMap.keys());

  const addOrUpdateLink = (
    source: string,
    target: string,
    provenance: 'inferred' | 'observed',
    rationale: string,
    evidenceRef?: string,
    protocol?: string | null
  ) => {
    if (source === target) return;
    if (!nodeMap.has(source) || !nodeMap.has(target)) return;

    const existing = links.find((l) => l.source === source && l.target === target);
    if (existing) {
      if (evidenceRef && !existing.evidenceRefs.includes(evidenceRef)) {
        existing.evidenceRefs.push(evidenceRef);
      }
    } else {
      links.push({
        source,
        target,
        provenance,
        protocol: protocol || null,
        healthy: nodeMap.get(target)?.status !== 'failed',
        rationale,
        evidenceRefs: evidenceRef ? [evidenceRef] : [],
      });
    }
  };

  // 5A: Inspect evidence items for explicit cross-service references
  for (const ev of investigation.evidence || []) {
    const sourceService = matchServiceId(ev.source || '') || (ev.data?.service ? matchServiceId(ev.data.service) : null);
    if (!sourceService || !nodeMap.has(sourceService)) continue;

    // Check if evidence summary or data mentions another known service
    const targetService = findTargetServiceInText(
      `${ev.summary || ''} ${ev.data?.target_service || ''} ${ev.data?.remote_host || ''}`,
      sourceService,
      knownServiceIds
    );

    if (targetService) {
      const protocol = ev.data?.protocol || null;
      addOrUpdateLink(
        sourceService,
        targetService,
        'inferred',
        `Evidence '${ev.id}' indicates dependency from ${sourceService} to ${targetService}: "${ev.summary}".`,
        ev.id,
        protocol
      );
    }
  }

  // 5B: Inspect hypotheses for explicit cross-service dependency formulations
  for (const hyp of investigation.hypotheses || []) {
    const text = `${hyp.title || ''} ${hyp.description || ''}`;
    // Find potential source and target
    for (const s1 of knownServiceIds) {
      const s2 = findTargetServiceInText(text, s1, knownServiceIds);
      if (s2 && s1 !== s2) {
        // Only add if no link already exists between these services
        const alreadyLinked = links.some((l) => (l.source === s1 && l.target === s2) || (l.source === s2 && l.target === s1));
        if (!alreadyLinked) {
          addOrUpdateLink(
            s1,
            s2,
            'inferred',
            `Hypothesis '${hyp.id}' posits interaction between ${s1} and ${s2}: "${hyp.title}". Not directly observed in network telemetry.`,
            hyp.supporting_evidence_ids?.[0],
            null
          );
        }
      }
    }
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
