/**
 * ABOUTME: WebSocket client for the ChoraForge web UI.
 * Connects to the remote server's WebSocket endpoint, handles auth,
 * and provides typed request/response methods for evolution data.
 */

import type { RemoteEvolutionState, RemoteVersionDetail, EvolutionEvent, AppCellStatusUI } from './types.js';

type MessageHandler = (data: unknown) => void;

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * WebSocket client for the ChoraForge web UI.
 * Mirrors the pattern from src/remote/client.ts.
 */
export class EvolutionClient {
  private ws: WebSocket | null = null;
  private url: string;
  private token: string;
  private connectionToken: string | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private eventHandlers = new Map<string, Set<MessageHandler>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private maxReconnectAttempts = 10;
  private _connected = false;

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  get connected(): boolean {
    return this._connected;
  }

  /**
   * Connect to the WebSocket server.
   */
  connect(): void {
    if (this.ws) return;

    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      // Authenticate immediately
      this.sendRaw({
        type: 'auth',
        id: this.generateId(),
        timestamp: new Date().toISOString(),
        token: this.connectionToken ?? this.token,
        tokenType: this.connectionToken ? 'connection' : 'server',
      });
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);
        this.handleMessage(data);
      } catch {
        // Invalid JSON
      }
    };

    this.ws.onclose = () => {
      this._connected = false;
      this.ws = null;
      this.emit('disconnected', null);
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire after this
    };
  }

  /**
   * Disconnect from the server.
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
  }

  /**
   * Subscribe to evolution events from the server.
   */
  async subscribe(): Promise<void> {
    await this.request('subscribe', { eventTypes: [] });
  }

  /**
   * Get current evolution state.
   */
  async getEvolutionState(): Promise<RemoteEvolutionState | null> {
    const response = await this.request('get_evolution_state', {}) as { success: boolean; state?: RemoteEvolutionState };
    return response.success ? (response.state ?? null) : null;
  }

  /**
   * Get detailed version info.
   */
  async getVersionDetail(version: number): Promise<RemoteVersionDetail | null> {
    const response = await this.request('get_version_detail', { version }) as { success: boolean; detail?: RemoteVersionDetail };
    return response.success ? (response.detail ?? null) : null;
  }

  /**
   * Get list of all registered apps (multi-app mode).
   */
  async listApps(): Promise<AppCellStatusUI[]> {
    const response = await this.request('list_apps', {}) as { success: boolean; apps?: AppCellStatusUI[] };
    return response.success ? (response.apps ?? []) : [];
  }

  /**
   * Create a new app via the orchestrator.
   */
  async createApp(name: string, blueprintPath?: string, description?: string): Promise<{ success: boolean; appId?: string; error?: string }> {
    const response = await this.request('create_app', { name, blueprintPath, description }) as { success: boolean; appId?: string; error?: string };
    return response;
  }

  /**
   * Get detailed status for a specific app.
   */
  async getAppStatus(appId: string): Promise<{ success: boolean; status?: AppCellStatusUI; error?: string }> {
    const response = await this.request('get_app_status', { appId }) as { success: boolean; status?: AppCellStatusUI; error?: string };
    return response;
  }

  /**
   * Pause evolution for an app.
   */
  async pauseApp(appId: string): Promise<{ success: boolean; error?: string }> {
    const response = await this.request('pause_app', { appId }) as { success: boolean; error?: string };
    return response;
  }

  /**
   * Resume evolution for a paused app.
   */
  async resumeApp(appId: string): Promise<{ success: boolean; error?: string }> {
    const response = await this.request('resume_app', { appId }) as { success: boolean; error?: string };
    return response;
  }

  /**
   * Stop evolution for an app.
   */
  async stopApp(appId: string): Promise<{ success: boolean; error?: string }> {
    const response = await this.request('stop_app', { appId }) as { success: boolean; error?: string };
    return response;
  }

  /**
   * Register a handler for a specific event type.
   */
  on(eventType: string, handler: MessageHandler): () => void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    this.eventHandlers.get(eventType)!.add(handler);
    return () => {
      this.eventHandlers.get(eventType)?.delete(handler);
    };
  }

  private handleMessage(data: Record<string, unknown>): void {
    const { type, id } = data;

    // Handle auth response
    if (type === 'auth_response') {
      if (data.success) {
        this._connected = true;
        if (data.connectionToken) {
          this.connectionToken = data.connectionToken as string;
        }
        this.emit('connected', null);
      } else {
        this.emit('auth_failed', data.error);
      }
      return;
    }

    // Handle correlated responses
    if (id && this.pendingRequests.has(id as string)) {
      const pending = this.pendingRequests.get(id as string)!;
      this.pendingRequests.delete(id as string);
      clearTimeout(pending.timeout);
      pending.resolve(data);
      return;
    }

    // Handle evolution events
    if (type === 'evolution_event') {
      this.emit('evolution_event', data.event);
      return;
    }

    // Handle engine events
    if (type === 'engine_event') {
      this.emit('engine_event', data.event);
      return;
    }

    // Handle orchestrator events (US-12)
    if (type === 'orchestrator_event') {
      this.emit('orchestrator_event', data.event);
      return;
    }

    // Emit by type for any other messages
    this.emit(type as string, data);
  }

  private emit(eventType: string, data: unknown): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      for (const handler of handlers) {
        try { handler(data); } catch { /* ignore handler errors */ }
      }
    }
  }

  private request(type: string, payload: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.generateId();
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request ${type} timed out`));
      }, 30_000);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      this.sendRaw({
        type,
        id,
        timestamp: new Date().toISOString(),
        ...payload,
      });
    });
  }

  private sendRaw(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempt >= this.maxReconnectAttempts) return;

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), 30_000);
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15);
  }
}
