/**
 * ABOUTME: React hook for subscribing to multi-app state via WebSocket.
 * Provides real-time app list, status updates, and app creation.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { EvolutionClient } from '../lib/ws-client.js';
import type { AppCellStatusUI } from '../lib/types.js';

interface UseAppsResult {
  apps: AppCellStatusUI[];
  connected: boolean;
  error: string | null;
  refresh: () => void;
  createApp: (name: string, blueprintPath?: string, description?: string) => Promise<{ success: boolean; appId?: string; error?: string }>;
}

export function useApps(wsUrl: string, token: string): UseAppsResult {
  const [apps, setApps] = useState<AppCellStatusUI[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<EvolutionClient | null>(null);

  const refresh = useCallback(() => {
    if (clientRef.current?.connected) {
      clientRef.current.listApps().then(setApps).catch(() => {});
    }
  }, []);

  const createApp = useCallback(async (name: string, blueprintPath?: string, description?: string) => {
    if (!clientRef.current?.connected) {
      return { success: false, error: 'Not connected' };
    }
    const result = await clientRef.current.createApp(name, blueprintPath, description);
    if (result.success) {
      // Refresh the app list after successful creation
      refresh();
    }
    return result;
  }, [refresh]);

  useEffect(() => {
    const client = new EvolutionClient(wsUrl, token);
    clientRef.current = client;

    client.on('connected', () => {
      setConnected(true);
      setError(null);
      // Fetch initial app list
      client.listApps().then(setApps).catch(() => {});
    });

    client.on('disconnected', () => {
      setConnected(false);
    });

    client.on('auth_failed', (err) => {
      setError(err as string ?? 'Authentication failed');
    });

    // Listen for app creation events
    client.on('app_created', (data) => {
      const msg = data as { success: boolean; appId?: string; appName?: string };
      if (msg.success) {
        // Refresh the app list
        client.listApps().then(setApps).catch(() => {});
      }
    });

    // Listen for orchestrator events that affect app status
    client.on('orchestrator_event', () => {
      // Refresh app list on any orchestrator event
      client.listApps().then(setApps).catch(() => {});
    });

    // Subscribe to events
    client.on('engine_event', () => {
      // Engine events may indicate status changes, refresh app list
      client.listApps().then(setApps).catch(() => {});
    });

    client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [wsUrl, token]);

  return { apps, connected, error, refresh, createApp };
}
