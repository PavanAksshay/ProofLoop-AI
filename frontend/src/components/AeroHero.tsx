import React, { useState } from 'react';

interface AeroHeroProps {
  totalIncidents?: number;
}

export const AeroHero: React.FC<AeroHeroProps> = ({ totalIncidents = 0 }) => {
  const [isDismissed, setIsDismissed] = useState(false);

  if (isDismissed) return null;

  return (
    <div className="aero-banner" data-testid="aero-hero">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxWidth: '720px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="badge badge-cyan" style={{ fontSize: '0.68rem', padding: '2px 8px' }}>
            AGENTOPS GOVERNANCE
          </span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Asymmetric Policy & Verification Architecture
          </span>
        </div>
        <div style={{ fontSize: '0.925rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          Untrusted AI Proposes &bull; Deterministic Policy Gates &bull; 3-Check Probes Verify
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
          Autonomous actions are constrained by strict client policy. Requisite approval halts execution without simulator mutations, and HTTP 200 responses are independently validated against synthetic transaction ground truth.
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <div className="aero-metric-pill">
          <span>🔬</span>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>VERIFIER</div>
            <strong>3 Independent Checks</strong>
          </div>
        </div>
        <div className="aero-metric-pill">
          <span>🛡️</span>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>POLICY</div>
            <strong>Deterministic Gate</strong>
          </div>
        </div>
        <div className="aero-metric-pill">
          <span>📜</span>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>HISTORY</div>
            <strong>{totalIncidents} Logged</strong>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsDismissed(true)}
          style={{
            padding: '4px 8px',
            color: 'var(--text-muted)',
            fontSize: '0.85rem',
            marginLeft: '4px',
            borderRadius: 'var(--radius-sm)',
          }}
          title="Dismiss banner"
          aria-label="Dismiss banner"
        >
          ✕
        </button>
      </div>
    </div>
  );
};
