/**
 * ABOUTME: Version detail page showing report, screenshot, and variant comparison.
 * Displayed when clicking a version in the timeline.
 */

import React, { useEffect } from 'react';
import type { RemoteEvolutionState } from '../lib/types.js';
import { useVersionDetail } from '../hooks/useVersionDetail.js';
import { VariantComparison } from '../components/VariantComparison.js';

interface Props {
  state: RemoteEvolutionState;
  version: number;
  wsUrl: string;
  token: string;
  onBack: () => void;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.round(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

export function VersionDetail({ state, version, wsUrl, token, onBack }: Props): React.ReactElement {
  const { detail, loading, fetch: fetchDetail } = useVersionDetail(wsUrl, token);

  // Find the version summary from the state
  const summary = state.versions.find(v => v.version === version);

  useEffect(() => {
    // Small delay to let the WebSocket connect
    const timer = setTimeout(() => fetchDetail(version), 500);
    return () => clearTimeout(timer);
  }, [version, fetchDetail]);

  if (!summary) {
    return (
      <div className="mt-4">
        <button className="btn" onClick={onBack}>&larr; Back</button>
        <div className="card mt-4">
          <div className="text-sm text-muted">Version {version} not found</div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4">
      {/* Header */}
      <div className="flex gap-3 mb-2" style={{ alignItems: 'center' }}>
        <button className="btn" onClick={onBack}>&larr; Back</button>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>
          Version {summary.gitTag}
        </h2>
        <span className="text-sm text-muted">
          {new Date(summary.timestamp).toLocaleDateString(undefined, {
            year: 'numeric', month: 'long', day: 'numeric',
          })}
        </span>
      </div>

      <div className="grid grid-2 mt-4">
        {/* Left: Screenshot + Summary */}
        <div className="flex flex-col gap-4">
          {/* Screenshot */}
          <div className="card">
            <div className="card-title mb-2">Screenshot</div>
            <div className="screenshot-container">
              {summary.screenshotPath ? (
                <img
                  src={`/screenshots/${summary.screenshotPath.replace('evolution/screenshots/', '')}`}
                  alt={`Version ${summary.gitTag}`}
                />
              ) : (
                <div className="screenshot-placeholder">No screenshot captured</div>
              )}
            </div>
          </div>

          {/* Summary stats */}
          <div className="card">
            <div className="card-title mb-2">Summary</div>
            <div className="flex flex-col gap-2">
              <div className="flex" style={{ justifyContent: 'space-between' }}>
                <span className="text-sm text-muted">Duration</span>
                <span className="font-mono text-sm">{formatDuration(summary.durationMs)}</span>
              </div>
              <div className="flex" style={{ justifyContent: 'space-between' }}>
                <span className="text-sm text-muted">Winning Agent</span>
                <span className="font-mono text-sm">{summary.selectedAgent}</span>
              </div>
              <div className="flex" style={{ justifyContent: 'space-between' }}>
                <span className="text-sm text-muted">Quality Score</span>
                <span className="font-mono text-sm font-bold" style={{
                  color: summary.qualityScore >= 80 ? 'var(--success)' :
                         summary.qualityScore >= 50 ? 'var(--warning)' : 'var(--error)',
                }}>
                  {summary.qualityScore}/100
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Criteria + Variants */}
        <div className="flex flex-col gap-4">
          {/* Criteria progress in this version */}
          <div className="card">
            <div className="card-title mb-2">Criteria Progress</div>

            {summary.criteriaDelta.length > 0 ? (
              <div className="flex flex-col gap-2">
                {summary.criteriaDelta.map(id => {
                  const criterion = state.blueprint?.criteria.find(c => c.id === id);
                  return (
                    <div key={id} className="flex gap-3" style={{ alignItems: 'center' }}>
                      <span className="criteria-chip new">{id}</span>
                      <span className="text-sm">{criterion?.description ?? 'Unknown criterion'}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-sm text-muted">No new criteria met in this version</div>
            )}

            <div className="mt-4 text-xs text-muted">
              Total after this version: {summary.criteriaMetAfter.length} criteria met
              ({summary.criteriaMetBefore.length} before)
            </div>
          </div>

          {/* Variant comparison */}
          {loading ? (
            <div className="card">
              <div className="text-sm text-muted">Loading variant data...</div>
            </div>
          ) : detail?.allScores && detail.allScores.length > 0 ? (
            <VariantComparison
              scores={detail.allScores}
              selectedAgent={summary.selectedAgent}
            />
          ) : (
            <div className="card">
              <div className="card-title mb-2">Variant Comparison</div>
              <div className="text-sm text-muted">
                Variant scores not available for this version
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
