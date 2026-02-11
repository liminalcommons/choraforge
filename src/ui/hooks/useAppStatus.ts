/**
 * ABOUTME: React hook for subscribing to a specific app's status via WebSocket.
 * Provides real-time agent activity, evolution progress, and app status.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { EvolutionClient } from '../lib/ws-client.js';
import type { AppCellStatusUI } from '../lib/types.js';

interface UseAppStatusResult {
  status: AppCellStatusUI | null;
  connected: boolean;
  error: string | null;
  refresh: () => void;
}

export function useAppStatus(wsUrl: string, token: string, appId: string): UseAppStatusResult {
  const [status, setStatus] = useState<AppCellStatusUI | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<EvolutionClient | null>(null);

  const refresh = useCallback(() => {
    if (clientRef.current?.connected && appId) {
      clientRef.current.getAppStatus(appId).then(result => {
        if (result.success && result.status) {
          setStatus(result.status);
        }
      }).catch(() => {});
    }
  }, [appId]);

  useEffect(() => {
    if (!appId) return;

    const client = new EvolutionClient(wsUrl, token);
    clientRef.current = client;

    client.on('connected', () => {
      setConnected(true);
      setError(null);
      // Subscribe to events and fetch initial status
      client.subscribe().catch(() => {});
      refresh();
    });

    client.on('disconnected', () => {
      setConnected(false);
    });

    client.on('auth_failed', (err) => {
      setError(err as string ?? 'Authentication failed');
    });

    // Listen for orchestrator events to update status
    client.on('orchestrator_event', (event) => {
      const ev = event as { type: string; appId: string; appName: string };
      // Only update if this event is for our app
      if (ev.appId === appId) {
        refresh();
      }
    });

    client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [wsUrl, token, appId, refresh]);

  return { status, connected, error, refresh };
}
