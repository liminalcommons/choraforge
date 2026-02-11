/**
 * ABOUTME: Agent activity component showing live agent task and evolution progress.
 * Displays current task, criterion being addressed, and recent activity log.
 */

import React from 'react';
import type { AgentAdapterStatusUI, EvolutionProgressUI } from '../lib/types.js';

interface Props {
  agent: AgentAdapterStatusUI;
  evolution: EvolutionProgressUI;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
}

export function AgentActivity({ agent, evolution, onPause, onResume, onStop }: Props): React.ReactElement {
  const isEvolving = agent.state === 'evolving';
  const isRunning = evolution.running;

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Agent Activity</span>
        <div className="flex gap-2">
          {isRunning && onPause && (
            <button className="btn text-xs" onClick={onPause}>
              Pause
            </button>
          )}
          {!isRunning && onResume && (
            <button className="btn text-xs" onClick={onResume}>
              Resume
            </button>
          )}
          {isRunning && onStop && (
            <button className="btn text-xs" onClick={onStop} style={{ color: 'var(--error)', borderColor: 'var(--error)' }}>
              Stop
            </button>
          )}
        </div>
      </div>

      {/* Current Task */}
      {isEvolving && (
        <div style={{ marginBottom: 16 }}>
          <div className="text-xs text-muted mb-1">CURRENT TASK</div>
          <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
            {agent.currentTask}
          </div>
          {agent.criterionId && (
            <div className="mt-2">
              <span className="criteria-chip new">{agent.criterionId}</span>
            </div>
          )}
        </div>
      )}

      {/* Evolution Progress */}
      {evolution.totalGaps > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div className="flex gap-3" style={{ alignItems: 'center', marginBottom: 8 }}>
            <span className="text-xs text-muted">EVOLUTION PROGRESS</span>
            <span className="text-xs font-mono">
              {evolution.gapsCompleted}/{evolution.totalGaps} gaps
            </span>
          </div>
          <div className="progress-bar">
            <div
              className={`progress-fill ${evolution.gapsCompleted === evolution.totalGaps ? 'complete' : ''}`}
              style={{ width: `${evolution.totalGaps > 0 ? (evolution.gapsCompleted / evolution.totalGaps) * 100 : 0}%` }}
            />
          </div>
          {evolution.currentGap && (
            <div className="text-xs text-muted mt-2" style={{ fontStyle: 'italic' }}>
              Working on: {evolution.currentGap}
            </div>
          )}
        </div>
      )}

      {/* Status States */}
      {!isEvolving && agent.state === 'idle' && (
        <div className="text-sm text-muted">
          Agent is idle. Start evolution to begin.
        </div>
      )}

      {!isEvolving && agent.state === 'stopped' && (
        <div className="text-sm" style={{ color: 'var(--error)' }}>
          Stopped: {agent.reason}
        </div>
      )}

      {!isEvolving && agent.state === 'error' && (
        <div className="text-sm" style={{ color: 'var(--error)' }}>
          Error: {agent.error}
        </div>
      )}

      {!isRunning && evolution.gapsCompleted > 0 && (
        <div className="text-sm" style={{ color: 'var(--success)' }}>
          Evolution completed. {evolution.gapsCompleted} gaps addressed.
        </div>
      )}
    </div>
  );
}
