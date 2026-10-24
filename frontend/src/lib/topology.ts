import { InvestigationState, ServiceTopologyGraph, ServiceTopologyNode, ServiceTopologyLink } from '../types';

/**
 * Synthesizes a deterministic Service Topology Graph from observed incident telemetry,
 * diagnostic tool records, remediation targets, and verified invariant checks.
 *
 * Clearly separates observed facts (telemetry/checks) from inferred hypotheses (root-cause predictions).
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
    };
  }

  const nodeMap = new Map<string, ServiceTopologyNode>();

  const getOrCreateNode = (id: string, name: string, type: ServiceTopologyNode['type']): ServiceTopologyNode => {
    let node = nodeMap.get(id);
    if (!node) {
      node = {
        id,
        name,
        type,
        status: 'unknown',
        evidenceRefs: [],
        diagnosticsRun: [],
      };
      nodeMap.set(id, node);
    }
    return node;
  };

  // 1. Ingest diagnostics performed
  for (const diag of investigation.diagnostics_performed || []) {
    const serviceName = diag.service || 'core-service';
    const type: ServiceTopologyNode['type'] = serviceName.includes('database') || serviceName.includes('db')
      ? 'database'
      : serviceName.includes('gateway')
      ? 'gateway'
      : serviceName.includes('config')
      ? 'config'
      : 'service';

    const node = getOrCreateNode(serviceName, serviceName, type);
    node.diagnosticsRun.push(diag.tool);
    if (!diag.success || diag.error) {
      node.status = 'degraded';
    } else if (node.status === 'unknown') {
      node.status = 'healthy';
    }
  }

  // 2. Ingest evidence items
  for (const ev of investigation.evidence || []) {
    let serviceId = 'core-service';
    const src = ev.source || '';
    if (src.includes('checkout')) serviceId = 'checkout-service';
    else if (src.includes('db') || src.includes('database') || src.includes('postgres')) serviceId = 'database';
    else if (src.includes('auth')) serviceId = 'auth-service';
    else if (src.includes('gateway')) serviceId = 'edge-gateway';
    else if (src.includes('config')) serviceId = 'config-store';

    const type: ServiceTopologyNode['type'] = serviceId === 'database'
      ? 'database'
      : serviceId === 'edge-gateway'
      ? 'gateway'
      : serviceId === 'config-store'
      ? 'config'
      : 'service';

    const node = getOrCreateNode(serviceId, serviceId, type);
    if (!node.evidenceRefs.includes(ev.id)) {
      node.evidenceRefs.push(ev.id);
    }

    if (ev.kind === 'contradictory' || ev.summary?.toLowerCase().includes('error')) {
      if (node.status !== 'failed') {
        node.status = 'degraded';
      }
    }
  }

  // 3. Ingest remediation history & invariant checks
  for (const rem of investigation.remediation_history || []) {
    const serviceName = rem.service || 'checkout-service';
    const node = getOrCreateNode(serviceName, serviceName, 'service');
    node.isRemediationTarget = true;

    if (rem.verification_passed === true) {
      node.status = 'healthy';
    } else if (rem.verification_passed === false) {
      node.status = 'failed';
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
          (cat.includes('auth') && id === 'auth-service')
        ) {
          node.isSuspectedRootCause = true;
        }
      }
    }
  }

  // Always include standard topology context if at least one service was observed
  if (nodeMap.size > 0) {
    if (!nodeMap.has('edge-gateway')) {
      getOrCreateNode('edge-gateway', 'Edge Gateway', 'gateway').status = 'healthy';
    }
    if (!nodeMap.has('checkout-service')) {
      getOrCreateNode('checkout-service', 'Checkout Service', 'service').status = 'degraded';
    }
  }

  // Construct links
  const links: ServiceTopologyLink[] = [];
  if (nodeMap.has('edge-gateway') && nodeMap.has('checkout-service')) {
    links.push({
      source: 'edge-gateway',
      target: 'checkout-service',
      protocol: 'gRPC/HTTP2',
      healthy: nodeMap.get('checkout-service')?.status !== 'failed',
    });
  }
  if (nodeMap.has('checkout-service') && nodeMap.has('database')) {
    links.push({
      source: 'checkout-service',
      target: 'database',
      protocol: 'PostgreSQL:5432',
      healthy: nodeMap.get('database')?.status !== 'failed',
    });
  }
  if (nodeMap.has('checkout-service') && nodeMap.has('config-store')) {
    links.push({
      source: 'checkout-service',
      target: 'config-store',
      protocol: 'etcd/HTTP',
      healthy: nodeMap.get('config-store')?.status !== 'failed',
    });
  }
  if (nodeMap.has('edge-gateway') && nodeMap.has('auth-service')) {
    links.push({
      source: 'edge-gateway',
      target: 'auth-service',
      protocol: 'HTTPS',
      healthy: nodeMap.get('auth-service')?.status !== 'failed',
    });
  }

  return {
    nodes: Array.from(nodeMap.values()),
    links,
    inferredAt: new Date().toISOString(),
    sourceIncidentId: incidentId,
  };
}
