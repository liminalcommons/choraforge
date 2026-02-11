/**
 * ABOUTME: Dashboard page showing a grid of app container cards.
 * Supports both single-app legacy mode and multi-app mode.
 */

import React from 'react';
import type { RemoteEvolutionState, AppCellStatusUI } from '../lib/types.js';
import { AppCard, AppCardMulti } from '../components/AppCard.js';

interface Props {
  state: RemoteEvolutionState | null;
  apps: AppCellStatusUI[];
  onSelectApp: (appId: string) => void;
  onCreateApp: () => void;
  connected: boolean;
}

export function Dashboard({ state, apps, onSelectApp, onCreateApp, connected }: Props): React.ReactElement {
  // Determine mode: multi-app if we have apps from the API, otherwise fall back to single-app
  const hasMultipleApps = apps.length > 0;

  if (!connected) {
    return (
      <div className="mt-4">
        <div className="card">
          <div className="text-sm text-muted" style={{ textAlign: 'center', padding: '40px 0' }}>
            Waiting for connection to ChoraForge engine...
          </div>
        </div>
      </div>
    );
  }

  // Multi-app mode
  if (hasMultipleApps) {
    return (
      <div className="mt-4">
        <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 15, color: 'var(--text-secondary)', fontWeight: 500 }}>
            Apps ({apps.length})
          </h2>
          <button className="btn btn-primary" onClick={onCreateApp}>
            + Create App
          </button>
        </div>
        <div className="grid grid-3">
          {apps.map(app => (
            <AppCardMulti
              key={app.appId}
              app={app}
              onClick={() => onSelectApp(app.appId)}
            />
          ))}
        </div>
      </div>
    );
  }

  // Single-app legacy mode (fallback)
  if (state) {
    return (
      <div className="mt-4">
        <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 15, color: 'var(--text-secondary)', fontWeight: 500 }}>
            App
          </h2>
          <button className="btn btn-primary" onClick={onCreateApp}>
            + Create App
          </button>
        </div>
        <div className="grid grid-3">
          <AppCard state={state} onClick={() => onSelectApp(state.appId)} />
        </div>
      </div>
    );
  }

  // Empty state
  return (
    <div className="mt-4">
      <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, color: 'var(--text-secondary)', fontWeight: 500 }}>
          Apps
        </h2>
        <button className="btn btn-primary" onClick={onCreateApp}>
          + Create App
        </button>
      </div>
      <div className="card" style={{ textAlign: 'center', padding: '60px 40px' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🚀</div>
        <div className="text-sm text-muted mb-2">No apps yet</div>
        <div className="text-xs text-muted mb-4" style={{ color: 'var(--text-muted)' }}>
          Create your first app to start the evolution process
        </div>
        <button className="btn btn-primary" onClick={onCreateApp}>
          Create Your First App
        </button>
      </div>
    </div>
  );
}
