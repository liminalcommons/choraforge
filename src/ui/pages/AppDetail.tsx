/**
 * ABOUTME: App detail page showing evolution timeline, blueprint progress, and status.
 * The main view when a user clicks into a specific app from the dashboard.
 */

import React from 'react';
import type { RemoteEvolutionState } from '../lib/types.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { BlueprintProgress } from '../components/BlueprintProgress.js';
import { VersionTimeline } from '../components/VersionTimeline.js';

interface Props {
  state: RemoteEvolutionState;
  onSelectVersion: (version: number) => void;
  onBack: () => void;
}

export function AppDetail({ state, onSelectVersion, onBack }: Props): React.ReactElement {
  return (
    <div className="mt-4">
      {/* Header */}
      <div className="flex gap-3 mb-2" style={{ alignItems: 'center' }}>
        <button className="btn" onClick={onBack}>&larr; Back</button>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>{state.appName}</h2>
        <StatusBadge status={state.status} />
        {state.currentVersion > 0 && (
          <span className="font-mono text-sm text-muted">v0.{state.currentVersion}</span>
        )}
      </div>

      {state.blueprint?.vision && (
        <p className="text-sm text-muted mb-2" style={{ maxWidth: 700 }}>
          {state.blueprint.vision}
        </p>
      )}

      {/* Two-column layout: Timeline + Blueprint */}
      <div className="grid grid-2 mt-4">
        <VersionTimeline
          versions={state.versions}
          currentVersion={state.currentVersion}
          status={state.status}
          onSelect={onSelectVersion}
        />

        <div className="flex flex-col gap-4">
          {state.blueprint && (
            <BlueprintProgress blueprint={state.blueprint} />
          )}
        </div>
      </div>
    </div>
  );
}
