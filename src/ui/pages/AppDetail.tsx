/**
 * ABOUTME: App detail page showing evolution timeline, blueprint progress, agent activity, and status.
 * The main view when a user clicks into a specific app from the dashboard.
 */

import React from 'react';
import type { RemoteEvolutionState, AppCellStatusUI } from '../lib/types.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { BlueprintProgress } from '../components/BlueprintProgress.js';
import { VersionTimeline } from '../components/VersionTimeline.js';
import { AgentActivity } from '../components/AgentActivity.js';

interface Props {
  state: RemoteEvolutionState;
  appStatus?: AppCellStatusUI;
  onSelectVersion: (version: number) => void;
  onBack: () => void;
  onUpdateBlueprint?: () => void;
  onPauseEvolution?: () => void;
  onResumeEvolution?: () => void;
  onStopEvolution?: () => void;
}

export function AppDetail({
  state,
  appStatus,
  onSelectVersion,
  onBack,
  onUpdateBlueprint,
  onPauseEvolution,
  onResumeEvolution,
  onStopEvolution,
}: Props): React.ReactElement {
  return (
    <div className="mt-4">
      {/* Header */}
      <div className="flex gap-3 mb-2" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="flex gap-3" style={{ alignItems: 'center' }}>
          <button className="btn" onClick={onBack}>&larr; Back</button>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>{state.appName}</h2>
          <StatusBadge status={state.status} />
          {state.currentVersion > 0 && (
            <span className="font-mono text-sm text-muted">v0.{state.currentVersion}</span>
          )}
        </div>
        {onUpdateBlueprint && state.blueprint && (
          <button className="btn btn-primary text-sm" onClick={onUpdateBlueprint}>
            Update Blueprint
          </button>
        )}
      </div>

      {state.blueprint?.vision && (
        <p className="text-sm text-muted mb-2" style={{ maxWidth: 700 }}>
          {state.blueprint.vision}
        </p>
      )}

      {/* Three-column layout: Timeline + AgentActivity + Blueprint */}
      <div className="grid grid-3 mt-4">
        <VersionTimeline
          versions={state.versions}
          currentVersion={state.currentVersion}
          status={state.status}
          onSelect={onSelectVersion}
        />

        {appStatus && (
          <AgentActivity
            agent={appStatus.agent}
            evolution={appStatus.evolution}
            onPause={onPauseEvolution}
            onResume={onResumeEvolution}
            onStop={onStopEvolution}
          />
        )}

        <div className="flex flex-col gap-4">
          {state.blueprint && (
            <BlueprintProgress blueprint={state.blueprint} />
          )}
        </div>
      </div>
    </div>
  );
}
