/**
 * ABOUTME: Vertical timeline component showing evolution version history.
 * Each version shows criteria delta, winning agent, and score.
 */

import React from 'react';
import type { VersionSummary, EvolutionStatus } from '../lib/types.js';

interface Props {
  versions: VersionSummary[];
  currentVersion: number;
  status: EvolutionStatus;
  onSelect: (version: number) => void;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.round(secs / 60);
  return `${mins}m`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function VersionTimeline({ versions, currentVersion, status, onSelect }: Props): React.ReactElement {
  const isActive = status !== 'idle' && status !== 'complete' && status !== 'stopped';

  // Show versions in reverse chronological order
  const sorted = [...versions].sort((a, b) => b.version - a.version);

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Version Timeline</span>
      </div>

      <div className="timeline">
        {/* Active evolution indicator */}
        {isActive && (
          <div className="timeline-item" style={{ opacity: 0.8 }}>
            <div className="timeline-dot active" />
            <div className="timeline-header">
              <span className="timeline-version">v0.{currentVersion}</span>
              <span className="text-xs" style={{ color: 'var(--accent)' }}>EVOLVING</span>
            </div>
            <div className="timeline-detail">
              {status === 'analyzing' && 'Running gap analysis...'}
              {status === 'spawning' && 'Spawning variants...'}
              {status === 'scoring' && 'Scoring variants...'}
              {status === 'merging' && 'Merging best variant...'}
            </div>
          </div>
        )}

        {sorted.map(v => (
          <div
            key={v.version}
            className="timeline-item"
            onClick={() => onSelect(v.version)}
          >
            <div className="timeline-dot complete" />
            <div className="timeline-header">
              <span className="timeline-version">{v.gitTag}</span>
              <span className="timeline-time">{formatTime(v.timestamp)}</span>
              <span className="timeline-time">{formatDuration(v.durationMs)}</span>
            </div>
            <div className="timeline-detail">
              {v.criteriaDelta.length > 0
                ? `${v.criteriaDelta.length} criteria met`
                : 'No new criteria met'}
              {' \u2014 '}
              {v.selectedAgent} won, score {v.qualityScore}
            </div>
            {v.criteriaDelta.length > 0 && (
              <div className="timeline-criteria">
                {v.criteriaDelta.map(id => (
                  <span key={id} className="criteria-chip new">{id}</span>
                ))}
              </div>
            )}
          </div>
        ))}

        {sorted.length === 0 && !isActive && (
          <div className="text-sm text-muted" style={{ paddingLeft: 8 }}>
            No versions yet. Start evolution to begin.
          </div>
        )}
      </div>
    </div>
  );
}
