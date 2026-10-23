import React, { useState } from 'react';
import { AlertTriangle, Lock, Check, X } from 'lucide-react';
import { Event } from '../types';

interface ApprovalCardProps {
  incidentId: string;
  pendingEvent: Event;
  onSubmitApproval: (decision: 'approve' | 'deny', approverId: string, comment: string) => Promise<void>;
  isSubmitting: boolean;
  approvalError: string | null;
}

export const ApprovalCard: React.FC<ApprovalCardProps> = ({
  incidentId,
  pendingEvent,
  onSubmitApproval,
  isSubmitting,
  approvalError,
}) => {
  const payload = pendingEvent.payload || {};
  const [approverId, setApproverId] = useState('demo-reviewer');
  const [comment, setComment] = useState('Reviewed proposed change in dashboard');

  const handleDecision = (decision: 'approve' | 'deny') => {
    if (!approverId.trim()) return;
    onSubmitApproval(decision, approverId.trim(), comment.trim());
  };

  return (
    <div className="border-2 border-amber-500 bg-amber-50/60 p-6 flex flex-col gap-4" data-testid="approval-card">
      {/* Alert Header */}
      <div className="flex items-center justify-between border-b border-amber-200 pb-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-amber-500 text-white flex items-center justify-center">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold tracking-wider uppercase text-amber-900 font-mono">
              HUMAN APPROVAL REQUIRED
            </h3>
            <span className="text-xs text-amber-700 font-mono">
              Incident: <span className="font-bold">{incidentId}</span>
            </span>
          </div>
        </div>
        <span className="badge badge-amber font-mono text-xs">
          GATE: APPROVAL_REQUIRED
        </span>
      </div>

      {/* Decision Proposal Details - Sharp Technical Box */}
      <div className="bg-[#FAF6F0] border border-amber-200 p-4 text-xs font-mono flex flex-col gap-2.5">
        <div className="flex justify-between items-center">
          <span className="text-zinc-500 uppercase tracking-wider">Proposed Tool:</span>
          <span className="font-bold text-cyan-700 bg-cyan-50 px-2 py-0.5 border border-cyan-200">
            {payload.tool || 'Unknown Tool'}
          </span>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-zinc-500 uppercase tracking-wider">Target Service:</span>
          <span className="font-bold text-zinc-900">
            {payload.service || 'checkout-service'}
          </span>
        </div>

        {payload.rule_id && (
          <div className="flex justify-between items-center">
            <span className="text-zinc-500 uppercase tracking-wider">Policy Rule ID:</span>
            <span className="bg-amber-100 text-amber-900 px-2 py-0.5 border border-amber-300 font-bold">
              {payload.rule_id}
            </span>
          </div>
        )}

        <div className="flex flex-col gap-1 pt-1 border-t border-zinc-100">
          <span className="text-zinc-500 uppercase tracking-wider">Policy Reason:</span>
          <span className="text-zinc-800 italic font-sans text-xs">
            "{payload.reason || 'Operation requires authorization prior to simulator execution.'}"
          </span>
        </div>

        {payload.arguments && Object.keys(payload.arguments).length > 0 && (
          <div className="pt-2 border-t border-zinc-100">
            <span className="text-zinc-500 uppercase tracking-wider block mb-1">Tool Arguments:</span>
            <pre className="payload-json text-xs">
              {JSON.stringify(payload.arguments, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* Safety Invariant Active Notice */}
      <div className="p-3 bg-red-50 border-l-4 border-red-500 text-xs text-red-800 leading-relaxed font-sans">
        <div className="flex items-center gap-1.5 font-bold mb-0.5">
          <Lock className="w-3.5 h-3.5" />
          <span>Safety Boundary Active:</span>
        </div>
        The synthetic service simulator has NOT been mutated. Execution is paused until an explicit decision is recorded.
      </div>

      {approvalError && (
        <div className="p-3 bg-red-100 border border-red-300 text-red-900 text-xs font-mono">
          ✕ {approvalError}
        </div>
      )}

      {/* Audit Identity Inputs & Actions */}
      <div className="flex flex-col gap-3 pt-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-mono uppercase tracking-wider text-zinc-600 block mb-1">
              Approver Identity (Audit Label):
            </label>
            <input
              type="text"
              value={approverId}
              onChange={(e) => setApproverId(e.target.value)}
              disabled={isSubmitting}
              className="w-full text-xs font-mono"
              placeholder="operator-id"
            />
          </div>
          <div>
            <label className="text-[11px] font-mono uppercase tracking-wider text-zinc-600 block mb-1">
              Review Comment:
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
  );
};
