/**
 * ABOUTME: App container card for the dashboard view.
 * Shows app name, current version, status, and criteria progress summary.
 * Supports both single-app (RemoteEvolutionState) and multi-app (AppCellStatusUI) modes.
 */

import React from 'react';
import type { RemoteEvolutionState, AppCellStatusUI, EvolutionStatus } from '../lib/types.js';
import { StatusBadge } from './StatusBadge.js';

interface Props {
  state: RemoteEvolutionState;
  onClick: () => void;
}

interface MultiAppProps {
  app: AppCellStatusUI;
  onClick: () => void;
}

/** Map app status to evolution status for badge display */
function appStatusToEvolutionStatus(app: AppCellStatusUI): EvolutionStatus {
  if (app.appStatus === 'error') return 'stopped';
  if (!app.evolution.running) {
    if (app.evolution.totalGaps > 0 && app.evolution.gapsCompleted >= app.evolution.totalGaps) {
      return 'complete';
    }
    return 'idle';
  }
  // Map agent state to evolution status
  if (app.agent.state === 'evolving') return 'spawning';
  return 'analyzing';
}

/** Legacy single-app card */
export function AppCard({ state, onClick }: Props): React.ReactElement {
  const total = state.blueprint?.criteria.length ?? 0;
  const met = state.blueprint?.criteria.filter(c => c.met).length ?? 0;
  const pct = total > 0 ? Math.round((met / total) * 100) : 0;

  return (
    <div className="card" onClick={onClick} style={{ cursor: 'pointer' }}>
      <div className="card-header">
        <span className="card-title">{state.appName}</span>
        <StatusBadge status={state.status} />
      </div>

      {state.blueprint ? (
        <>
          <div className="text-sm text-muted mb-2">
            {state.currentVersion > 0 ? `v0.${state.currentVersion}` : 'No versions yet'}
            {state.status !== 'idle' && state.status !== 'complete' && state.status !== 'stopped'
              ? ` \u2192 v0.${state.currentVersion + 1} evolving...`
              : ''}
          </div>

          <div className="flex gap-3" style={{ alignItems: 'center' }}>
            <span className="text-xs font-mono text-muted">{met}/{total}</span>
            <div className="progress-bar" style={{ flex: 1 }}>
              <div
                className={`progress-fill ${pct === 100 ? 'complete' : ''}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs font-mono text-muted">{pct}%</span>
          </div>
        </>
      ) : (
        <div className="text-sm text-muted">No blueprint configured</div>
      )}
    </div>
  );
}

/** Multi-app card for AppCellStatusUI */
export function AppCardMulti({ app, onClick }: MultiAppProps): React.ReactElement {
  const total = app.evolution.totalGaps;
  const met = app.evolution.gapsCompleted;
  const pct = total > 0 ? Math.round((met / total) * 100) : 0;
  const status = appStatusToEvolutionStatus(app);

  // Get agent type name
  const agentType = app.agent.state === 'idle' ? 'idle' :
    app.agent.state === 'evolving' ? 'evolving' :
    app.agent.state === 'stopped' ? 'stopped' : 'error';

  return (
    <div className="card" onClick={onClick} style={{ cursor: 'pointer' }}>
      <div className="card-header">
        <span className="card-title">{app.appName}</span>
        <StatusBadge status={status} />
      </div>

      <div className="text-sm text-muted mb-2">
        <span className="badge badge-idle" style={{ marginRight: 8 }}>{agentType}</span>
        {app.evolution.running && app.evolution.currentGap
          ? `Working: ${app.evolution.currentGap.slice(0, 40)}${app.evolution.currentGap.length > 40 ? '...' : ''}`
          : total > 0 ? `${met}/${total} criteria` : 'No blueprint'}
      </div>

      {total > 0 ? (
        <div className="flex gap-3" style={{ alignItems: 'center' }}>
          <span className="text-xs font-mono text-muted">{met}/{total}</span>
          <div className="progress-bar" style={{ flex: 1 }}>
            <div
              className={`progress-fill ${pct === 100 ? 'complete' : ''}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs font-mono text-muted">{pct}%</span>
        </div>
      ) : (
        <div className="text-sm text-muted">Configure blueprint to start evolution</div>
      )}
    </div>
  );
}
