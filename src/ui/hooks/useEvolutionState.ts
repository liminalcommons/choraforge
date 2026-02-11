/**
 * ABOUTME: React hook for subscribing to evolution state via WebSocket.
 * Provides real-time evolution status, blueprint progress, and version history.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { EvolutionClient } from '../lib/ws-client.js';
import type { RemoteEvolutionState, EvolutionEvent } from '../lib/types.js';

interface UseEvolutionStateResult {
  state: RemoteEvolutionState | null;
  connected: boolean;
  error: string | null;
  refresh: () => void;
}

export function useEvolutionState(wsUrl: string, token: string): UseEvolutionStateResult {
  const [state, setState] = useState<RemoteEvolutionState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<EvolutionClient | null>(null);

  const refresh = useCallback(() => {
    if (clientRef.current?.connected) {
      clientRef.current.getEvolutionState().then(setState).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const client = new EvolutionClient(wsUrl, token);
    clientRef.current = client;

    client.on('connected', () => {
      setConnected(true);
      setError(null);
      // Subscribe to events and fetch initial state
      client.subscribe().catch(() => {});
      client.getEvolutionState().then(setState).catch(() => {});
    });

    client.on('disconnected', () => {
      setConnected(false);
    });

    client.on('auth_failed', (err) => {
      setError(err as string ?? 'Authentication failed');
    });

    client.on('evolution_event', (event) => {
      const ev = event as EvolutionEvent;

      // Update state based on events
      setState(prev => {
        if (!prev) return prev;
        switch (ev.type) {
          case 'evolution:version-started':
            return { ...prev, status: 'analyzing', currentVersion: ev.version };
          case 'evolution:gap-analysis':
            return { ...prev, status: 'spawning' };
          case 'evolution:variants-spawned':
            return { ...prev, status: 'scoring' };
          case 'evolution:version-complete':
            // Refresh full state to get new version data
            client.getEvolutionState().then(setState).catch(() => {});
            return { ...prev, status: 'idle' };
          case 'evolution:complete':
            return { ...prev, status: 'complete' };
          case 'evolution:stopped':
            return { ...prev, status: 'stopped' };
          default:
            return prev;
        }
      });
    });

    client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [wsUrl, token]);

  return { state, connected, error, refresh };
}
