/**
 * ABOUTME: React hook for fetching version detail on demand.
 * Loads detailed version information including report and variant scores.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { EvolutionClient } from '../lib/ws-client.js';
import type { RemoteVersionDetail } from '../lib/types.js';

interface UseVersionDetailResult {
  detail: RemoteVersionDetail | null;
  loading: boolean;
  error: string | null;
  fetch: (version: number) => void;
}

export function useVersionDetail(wsUrl: string, token: string): UseVersionDetailResult {
  const [detail, setDetail] = useState<RemoteVersionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<EvolutionClient | null>(null);

  useEffect(() => {
    const client = new EvolutionClient(wsUrl, token);
    clientRef.current = client;
    client.connect();
    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [wsUrl, token]);

  const fetchDetail = useCallback((version: number) => {
    if (!clientRef.current?.connected) {
      setError('Not connected');
      return;
    }
    setLoading(true);
    setError(null);
    clientRef.current.getVersionDetail(version)
      .then((result) => {
        setDetail(result);
        if (!result) setError('Version not found');
      })
      .catch((err) => {
        setError(err.message ?? 'Failed to fetch version');
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return { detail, loading, error, fetch: fetchDetail };
}
