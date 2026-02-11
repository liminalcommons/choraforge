/**
 * ABOUTME: Variant comparison component showing side-by-side agent scores.
 * Displays horizontal score bars for each variant with agent names.
 */

import React from 'react';
import type { VariantScore } from '../lib/types.js';

interface Props {
  scores: VariantScore[];
  selectedAgent?: string;
}

const agentColors: Record<string, string> = {
  claude: '#818cf8',
  kimi: '#f59e0b',
  glm: '#22c55e',
  gemini: '#3b82f6',
  codex: '#a78bfa',
  cursor: '#ec4899',
  opencode: '#14b8a6',
};

export function VariantComparison({ scores, selectedAgent }: Props): React.ReactElement {
  if (scores.length === 0) {
    return (
      <div className="card">
        <div className="card-title mb-2">Variant Comparison</div>
        <div className="text-sm text-muted">No variant scores available</div>
      </div>
    );
  }

  const sorted = [...scores].sort((a, b) => b.qualityScore - a.qualityScore);

  return (
    <div className="card">
      <div className="card-title mb-2">Variant Comparison</div>
      <div className="flex flex-col gap-3">
        {sorted.map(score => {
          const isSelected = score.agentId === selectedAgent;
          const color = agentColors[score.agentId] ?? 'var(--accent)';

          return (
            <div key={score.workerId} className="score-bar-container">
              <span className="score-label" style={{
                color: isSelected ? color : 'var(--text-secondary)',
                fontWeight: isSelected ? 700 : 400,
              }}>
                {score.agentId}
                {isSelected && ' \u2190'}
              </span>
              <div className="score-bar">
                <div
                  className="score-fill"
                  style={{
                    width: `${score.qualityScore}%`,
                    background: isSelected ? color : 'var(--bg-hover)',
                  }}
                />
              </div>
              <span className="score-value" style={{
                color: isSelected ? color : 'var(--text-secondary)',
              }}>
                {score.qualityScore}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
