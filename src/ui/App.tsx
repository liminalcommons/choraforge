/**
 * ABOUTME: Root component for the ChoraForge web UI.
 * Provides layout, routing, and WebSocket connection context.
 * Supports both single-app legacy mode and multi-app mode.
 */

import React, { useState } from 'react';
import { useEvolutionState } from './hooks/useEvolutionState.js';
import { useApps } from './hooks/useApps.js';
import { useAppStatus } from './hooks/useAppStatus.js';
import { Dashboard } from './pages/Dashboard.js';
import { AppDetail } from './pages/AppDetail.js';
import { VersionDetail } from './pages/VersionDetail.js';
import { EvolutionClient } from './lib/ws-client.js';

// Derive WebSocket URL from current location
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProtocol}//${window.location.host}`;

// Token from URL query param or empty (for local dev without auth)
const params = new URLSearchParams(window.location.search);
const token = params.get('token') ?? '';

type View =
  | { page: 'dashboard' }
  | { page: 'app'; appId: string }
  | { page: 'version'; appId: string; version: number };

export function App(): React.ReactElement {
  const [view, setView] = useState<View>({ page: 'dashboard' });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newAppName, setNewAppName] = useState('');
  const [newAppDescription, setNewAppDescription] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Single-app legacy hook (for backward compatibility)
  const { state, connected: singleAppConnected, error: singleAppError } = useEvolutionState(wsUrl, token);

  // Multi-app hook
  const { apps, connected: multiAppConnected, error: multiAppError, createApp } = useApps(wsUrl, token);

  // App status hook for the currently viewed app
  const currentAppId = view.page === 'app' ? view.appId : null;
  const { status: appStatus } = useAppStatus(wsUrl, token, currentAppId ?? '');

  // Use multi-app connection status if we have apps, otherwise fall back to single-app
  const connected = apps.length > 0 ? multiAppConnected : singleAppConnected;
  const error = multiAppError || singleAppError;

  const navigate = (v: View) => setView(v);

  // Evolution control handlers
  const clientRef = React.useRef<EvolutionClient | null>(null);

  const getEvolutionClient = () => {
    if (!clientRef.current) {
      clientRef.current = new EvolutionClient(wsUrl, token);
    }
    return clientRef.current;
  };

  const handlePauseEvolution = async () => {
    if (currentAppId) {
      const client = getEvolutionClient();
      await client.pauseApp(currentAppId);
    }
  };

  const handleResumeEvolution = async () => {
    if (currentAppId) {
      const client = getEvolutionClient();
      await client.resumeApp(currentAppId);
    }
  };

  const handleStopEvolution = async () => {
    if (currentAppId) {
      const client = getEvolutionClient();
      await client.stopApp(currentAppId);
    }
  };

  const handleUpdateBlueprint = () => {
    // TODO: Open blueprint dialogue interface
    console.log('Update Blueprint - not implemented yet');
  };

  const handleCreateApp = async () => {
    if (!newAppName.trim()) {
      setCreateError('App name is required');
      return;
    }

    setIsCreating(true);
    setCreateError(null);

    try {
      const result = await createApp(newAppName.trim(), undefined, newAppDescription.trim() || undefined);
      if (result.success) {
        setShowCreateModal(false);
        setNewAppName('');
        setNewAppDescription('');
        // Navigate to the new app's detail page
        if (result.appId) {
          navigate({ page: 'app', appId: result.appId });
        }
      } else {
        setCreateError(result.error || 'Failed to create app');
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create app');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div>
      <header className="header">
        <h1
          style={{ cursor: 'pointer' }}
          onClick={() => navigate({ page: 'dashboard' })}
        >
          ChoraForge
        </h1>
        <div className="connection-indicator">
          <div className={`connection-dot ${connected ? 'connected' : 'disconnected'}`} />
          {connected ? 'Connected' : 'Disconnected'}
        </div>
      </header>

      <div className="container">
        {error && (
          <div className="card mt-4" style={{ borderColor: 'var(--error)' }}>
            <span style={{ color: 'var(--error)' }}>{error}</span>
          </div>
        )}

        {view.page === 'dashboard' && (
          <Dashboard
            state={state}
            apps={apps}
            connected={connected}
            onSelectApp={(appId) => navigate({ page: 'app', appId })}
            onCreateApp={() => setShowCreateModal(true)}
          />
        )}

        {view.page === 'app' && state && (
          <AppDetail
            state={state}
            appStatus={appStatus ?? undefined}
            onSelectVersion={(v) => navigate({ page: 'version', appId: view.appId, version: v })}
            onBack={() => navigate({ page: 'dashboard' })}
            onUpdateBlueprint={handleUpdateBlueprint}
            onPauseEvolution={handlePauseEvolution}
            onResumeEvolution={handleResumeEvolution}
            onStopEvolution={handleStopEvolution}
          />
        )}

        {view.page === 'version' && state && (
          <VersionDetail
            state={state}
            version={view.version}
            wsUrl={wsUrl}
            token={token}
            onBack={() => navigate({ page: 'app', appId: view.appId })}
          />
        )}

        {/* Create App Modal */}
        {showCreateModal && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}>
            <div className="card" style={{ width: 400, maxWidth: '90%' }}>
              <div className="card-header">
                <span className="card-title">Create New App</span>
              </div>

              <div className="mb-2">
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>
                  App Name *
                </label>
                <input
                  type="text"
                  value={newAppName}
                  onChange={(e) => setNewAppName(e.target.value)}
                  placeholder="my-awesome-app"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    fontSize: 14,
                  }}
                  disabled={isCreating}
                />
              </div>

              <div className="mb-2">
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>
                  Description
                </label>
                <textarea
                  value={newAppDescription}
                  onChange={(e) => setNewAppDescription(e.target.value)}
                  placeholder="What does this app do?"
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    fontSize: 14,
                    resize: 'vertical',
                  }}
                  disabled={isCreating}
                />
              </div>

              {createError && (
                <div style={{ color: 'var(--error)', fontSize: 13, marginBottom: 12 }}>
                  {createError}
                </div>
              )}

              <div className="flex gap-2" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
                <button
                  className="btn"
                  onClick={() => {
                    setShowCreateModal(false);
                    setNewAppName('');
                    setNewAppDescription('');
                    setCreateError(null);
                  }}
                  disabled={isCreating}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleCreateApp}
                  disabled={isCreating}
                >
                  {isCreating ? 'Creating...' : 'Create App'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
