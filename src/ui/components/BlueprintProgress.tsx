/**
 * ABOUTME: Blueprint progress component showing criteria met/unmet with visual progress bar.
 * Displays each criterion's status and overall completion percentage.
 */

import React from 'react';
import type { Blueprint } from '../lib/types.js';

interface Props {
  blueprint: Blueprint;
}

export function BlueprintProgress({ blueprint }: Props): React.ReactElement {
  const total = blueprint.criteria.length;
  const met = blueprint.criteria.filter(c => c.met).length;
  const pct = total > 0 ? Math.round((met / total) * 100) : 0;

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Blueprint Progress</span>
        <span className="font-mono text-sm" style={{ color: pct === 100 ? 'var(--success)' : 'var(--text-secondary)' }}>
          {met}/{total} criteria ({pct}%)
        </span>
      </div>

      <div className="progress-bar mb-2">
        <div
          className={`progress-fill ${pct === 100 ? 'complete' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex flex-col gap-2 mt-4">
        {blueprint.criteria.map(c => (
          <div key={c.id} className="flex gap-3" style={{ alignItems: 'flex-start' }}>
            <span style={{
              fontSize: 14,
              width: 18,
              textAlign: 'center',
              flexShrink: 0,
              marginTop: 1,
            }}>
              {c.met ? '\u2713' : '\u2022'}
            </span>
            <span className={`criteria-chip ${c.met ? 'met' : 'unmet'}`} style={{ flexShrink: 0 }}>
              {c.id} [{c.priority}]
            </span>
            <span className="text-sm" style={{
              color: c.met ? 'var(--text-secondary)' : 'var(--text-primary)',
              textDecoration: c.met ? 'line-through' : 'none',
              opacity: c.met ? 0.6 : 1,
            }}>
              {c.description}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
