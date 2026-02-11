/**
 * ABOUTME: Version card component showing details of a specific version.
 * Displays screenshot, criteria progress, winning agent, and score.
 */

import React from 'react';
import type { VersionSummary } from '../lib/types.js';

interface Props {
  version: VersionSummary;
  onClick: () => void;
}

export function VersionCard({ version, onClick }: Props): React.ReactElement {
  return (
    <div className="card" onClick={onClick} style={{ cursor: 'pointer' }}>
      {/* Screenshot preview */}
      <div className="screenshot-container mb-2">
        {version.screenshotPath ? (
          <img
            src={`/screenshots/${version.screenshotPath.replace('evolution/screenshots/', '')}`}
            alt={`Version ${version.gitTag}`}
            loading="lazy"
          />
        ) : (
          <div className="screenshot-placeholder">No screenshot</div>
        )}
      </div>

      <div className="flex gap-3" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="font-mono font-bold">{version.gitTag}</span>
        <span className="text-xs text-muted">
          {new Date(version.timestamp).toLocaleDateString()}
        </span>
      </div>

      <div className="text-sm mt-2">
        {version.criteriaDelta.length > 0 && (
          <div className="timeline-criteria">
            {version.criteriaDelta.map(id => (
              <span key={id} className="criteria-chip new">{id}</span>
            ))}
          </div>
        )}
      </div>

      <div className="flex mt-2" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="text-xs text-muted">{version.selectedAgent}</span>
        <span className="font-mono text-sm" style={{
          color: version.qualityScore >= 80 ? 'var(--success)' :
                 version.qualityScore >= 50 ? 'var(--warning)' : 'var(--error)',
        }}>
          {version.qualityScore}/100
        </span>
      </div>
    </div>
  );
}
