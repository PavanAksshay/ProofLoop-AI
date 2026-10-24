import React, { useMemo, useState } from 'react';
import {
  Network,
  Database,
  Server,
  KeyRound,
  FileCode2,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';
import { InvestigationState, ServiceTopologyNode } from '../types';
import { inferServiceTopology } from '../lib/topology';

interface ServiceTopologyExplorerProps {
  investigation: InvestigationState | null;
  incidentId: string | null;
  scenario?: string;
  onSelectEvidence?: (evidenceId: string) => void;
}

export const ServiceTopologyExplorer: React.FC<ServiceTopologyExplorerProps> = ({
  investigation,
  incidentId,
  scenario,
  onSelectEvidence,
}) => {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const graph = useMemo(() => {
    return inferServiceTopology(investigation, incidentId || 'unknown');
  }, [investigation, incidentId]);

  const selectedNode = useMemo(() => {
    return graph.nodes.find((n) => n.id === selectedNodeId) || graph.nodes[0] || null;
  }, [graph.nodes, selectedNodeId]);

  const getNodeIcon = (type: ServiceTopologyNode['type']) => {
    switch (type) {
      case 'database':
        return <Database className="w-5 h-5 text-cyan-700" />;
      case 'gateway':
        return <Network className="w-5 h-5 text-purple-700" />;
      case 'config':
        return <FileCode2 className="w-5 h-5 text-amber-700" />;
      case 'external':
        return <KeyRound className="w-5 h-5 text-rose-700" />;
      default:
        return <Server className="w-5 h-5 text-[#0E7490]" />;
    }
  };

  if (!investigation || graph.nodes.length === 0 || !graph.hasSufficientTelemetry) {
    return (
      <div className="panel p-10 flex flex-col items-center justify-center text-center gap-3 my-6" data-testid="topology-unavailable">
        <Network className="w-8 h-8 text-[#827869]" />
        <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-[#1C1917]">
          SERVICE TOPOLOGY TELEMETRY UNAVAILABLE
        </h2>
        <p className="text-xs text-[#827869] max-w-md leading-relaxed">
          The backend does not provide a static topology endpoint. Service boundaries and dependency links are dynamically synthesized from diagnostic tool traces, log evidence, and remediation targets once an active incident is selected.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-6" data-testid="service-topology-explorer">
      {/* Topology Header */}
      <div className="panel border-l-4 border-l-[#0E7490] flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-[#DFD7C7] pb-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#1C1917] text-[#FAF6F0] flex items-center justify-center font-mono">
              <Network className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-sm font-mono font-bold uppercase tracking-wider text-[#1C1917]">
                  SERVICE TOPOLOGY & ROOT-CAUSE EXPLORER
                </h1>
                {scenario && (
                  <span className="badge badge-synthetic font-mono text-[10px]">
                    {scenario}
                  </span>
                )}
                <span className="badge badge-synthetic font-mono text-[10px]">
                  {graph.nodes.length} Nodes &bull; {graph.links.length} Inferred Dependencies
                </span>
              </div>
              <p className="text-xs text-[#6B6255] font-sans mt-0.5">
                Dynamic microservice graph synthesized from observed diagnostics, log telemetry, and invariant proofs.
              </p>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-between flex-wrap gap-2 text-xs font-mono bg-[#FAF6F0] p-2.5 border border-[#DFD7C7]">
          <span className="font-bold text-[#1C1917]">PROVENANCE &amp; STATUS LEGEND:</span>
          <div className="flex items-center gap-3 flex-wrap text-[11px]">
            <span className="flex items-center gap-1 text-cyan-800 font-bold">
              <span className="badge badge-cyan text-[9px]">OBSERVED</span> Telemetry Record
            </span>
            <span className="flex items-center gap-1 text-amber-800 font-bold">
              <span className="badge badge-amber text-[9px]">INFERRED</span> Co-occurrence / Hypothesis
            </span>
            <span className="flex items-center gap-1 text-emerald-800">
              <CheckCircle2 className="w-3.5 h-3.5" /> Healthy (Verified)
            </span>
            <span className="flex items-center gap-1 text-amber-800">
              <AlertTriangle className="w-3.5 h-3.5" /> Degraded (Error Observed)
            </span>
            <span className="flex items-center gap-1 text-rose-800">
              <AlertCircle className="w-3.5 h-3.5" /> Failed (Invariant Breached)
            </span>
            <span className="flex items-center gap-1 text-[#0E7490] font-bold">
              ★ Inferred Root-Cause Target
            </span>
          </div>
        </div>
      </div>

      {/* Nodes Map & Detail View */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Nodes Grid */}
        <div className="panel lg:col-span-2">
          <div className="panel-header">
            <h2 className="panel-title">
              <Server className="w-4 h-4 text-[#0E7490]" />
              <span>Service Nodes</span>
            </h2>
            <span className="badge badge-synthetic font-mono text-xs">
              {graph.nodes.length} Services
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {graph.nodes.map((node) => {
              const isSelected = selectedNode?.id === node.id;
              return (
                <div
                  key={node.id}
                  onClick={() => setSelectedNodeId(node.id)}
                  className={`p-3.5 border transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                    isSelected
                      ? 'border-[#0E7490] bg-[#E4F0F2] ring-1 ring-[#0E7490]'
                      : 'border-[#DFD7C7] bg-[#ECE6DC] hover:border-[#827869]'
                  }`}
                  data-testid={`topology-node-${node.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-[#FAF6F0] border border-[#DFD7C7]">
                        {getNodeIcon(node.type)}
                      </div>
                      <div>
                        <div className="font-mono text-xs font-bold text-[#1C1917]">
                          {node.name}
                        </div>
                        <span className="badge badge-synthetic font-mono text-[9px] uppercase">
                          {node.type}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <span
                        className={`badge font-mono text-[10px] ${
                          node.status === 'healthy'
                            ? 'badge-emerald'
                            : node.status === 'degraded'
                            ? 'badge-amber'
                            : node.status === 'failed'
                            ? 'badge-rose'
                            : 'badge-synthetic'
                        }`}
                      >
                        {node.status.toUpperCase()}
                      </span>
                      <span
                        className={`badge font-mono text-[9px] uppercase ${
                          node.provenance === 'observed'
                            ? 'badge-cyan'
                            : node.provenance === 'inferred'
                            ? 'badge-amber'
                            : 'badge-synthetic'
                        }`}
                        title={`Provenance: ${node.provenance}`}
                      >
                        {node.provenance}
                      </span>
                    </div>
                  </div>

                  {node.isSuspectedRootCause && (
                    <div className="p-1.5 bg-[#E4F0F2] border border-[#B2D8DC] text-[#0E7490] font-mono text-[10px] flex items-center gap-1 font-bold">
                      <ShieldAlert className="w-3.5 h-3.5" />
                      <span>LEADING SUSPECTED ROOT CAUSE</span>
                    </div>
                  )}

                  <div className="text-[10px] font-mono text-[#6B6255] line-clamp-1 italic" title={node.statusRationale}>
                    {node.statusRationale}
                  </div>

                  <div className="pt-2 border-t border-[#DFD7C7] flex justify-between items-center text-[10px] font-mono text-[#6B6255]">
                    <span>Diagnostics: {node.diagnosticsRun.length}</span>
                    <span>Evidence: {node.evidenceRefs.length}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Inferred Dependency Links List */}
          <div className="mt-4 pt-4 border-t border-[#DFD7C7]">
            <span className="font-mono text-xs font-bold text-[#1C1917] block mb-2">
              Inferred Service Dependencies & Data Flow:
            </span>
            <div className="flex flex-col gap-1.5">
              {graph.links.map((link, idx) => (
                <div
                  key={idx}
                  className="p-2 bg-[#FAF6F0] border border-[#DFD7C7] font-mono text-xs flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-[#1C1917]">{link.source}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-[#827869]" />
                    <span className="font-bold text-[#1C1917]">{link.target}</span>
                    <span
                      className={`badge text-[9px] uppercase ${
                        link.provenance === 'observed' ? 'badge-cyan' : 'badge-amber'
                      }`}
                    >
                      {link.provenance} link
                    </span>
                    {link.protocol && (
                      <span className="badge badge-synthetic text-[9px]">
                        {link.protocol}
                      </span>
                    )}
                  </div>
                  <span
                    className={`badge text-[10px] ${
                      link.healthy ? 'badge-emerald' : 'badge-rose'
                    }`}
                    title={link.rationale}
                  >
                    {link.healthy ? 'HEALTHY' : 'DEGRADED'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Selected Node Detail Inspector */}
        <div className="panel flex flex-col justify-between">
          <div>
            <div className="panel-header">
              <h2 className="panel-title">
                <HelpCircle className="w-4 h-4 text-[#0E7490]" />
                <span>Service Inspector</span>
              </h2>
            </div>

            {selectedNode ? (
              <div className="flex flex-col gap-3 font-mono text-xs">
                <div className="bg-[#ECE6DC] p-3 border border-[#DFD7C7]">
                  <div className="text-[10px] uppercase text-[#6B6255] tracking-wider">
                    Inspected Service
                  </div>
                  <div className="text-sm font-bold text-[#1C1917] mt-0.5">
                    {selectedNode.name}
                  </div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span
                      className={`badge text-[10px] ${
                        selectedNode.status === 'healthy'
                          ? 'badge-emerald'
                          : selectedNode.status === 'degraded'
                          ? 'badge-amber'
                          : selectedNode.status === 'failed'
                          ? 'badge-rose'
                          : 'badge-synthetic'
                      }`}
                    >
                      Status: {selectedNode.status.toUpperCase()}
                    </span>
                    <span
                      className={`badge text-[10px] uppercase ${
                        selectedNode.provenance === 'observed'
                          ? 'badge-cyan'
                          : selectedNode.provenance === 'inferred'
                          ? 'badge-amber'
                          : 'badge-synthetic'
                      }`}
                    >
                      Provenance: {selectedNode.provenance}
                    </span>
                    {selectedNode.isRemediationTarget && (
                      <span className="badge badge-amber text-[10px]">
                        Remediation Target
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[#6B6255] mt-2 italic font-sans border-t border-[#DFD7C7] pt-1">
                    <strong>Rationale:</strong> {selectedNode.statusRationale}
                  </div>
                </div>

                {/* Diagnostics executed on this service */}
                <div>
                  <span className="text-[11px] font-bold text-[#1C1917] block mb-1">
                    Diagnostics Executed ({selectedNode.diagnosticsRun.length}):
                  </span>
                  {selectedNode.diagnosticsRun.length === 0 ? (
                    <span className="text-xs text-[#827869] italic font-sans">
                      No direct diagnostic tools executed on this node.
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {selectedNode.diagnosticsRun.map((tool, idx) => (
                        <span key={idx} className="badge badge-cyan font-mono text-[10px]">
                          {tool}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Correlated Evidence IDs */}
                <div>
                  <span className="text-[11px] font-bold text-[#1C1917] block mb-1">
                    Correlated Evidence ({selectedNode.evidenceRefs.length}):
                  </span>
                  {selectedNode.evidenceRefs.length === 0 ? (
                    <span className="text-xs text-[#827869] italic font-sans">
                      No direct evidence records correlated with this service.
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedNode.evidenceRefs.map((evId) => (
                        <button
                          key={evId}
                          type="button"
                          onClick={() => onSelectEvidence?.(evId)}
                          className="badge badge-synthetic font-mono text-[10px] hover:bg-[#1C1917] hover:text-[#FAF6F0] cursor-pointer"
                        >
                          {evId}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-6 text-center text-[#827869] text-xs">
                Select a service node from the topology map to inspect telemetry.
              </div>
            )}
          </div>

          <div className="pt-3 mt-4 border-t border-[#DFD7C7] text-[10px] text-[#6B6255] font-mono">
            Deterministic state derived without backend graph persistence.
          </div>
        </div>
      </div>
    </div>
  );
};
