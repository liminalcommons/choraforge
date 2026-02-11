/**
 * ABOUTME: Tests for RemoteServer class methods.
 * Focuses on testable methods that don't require a running WebSocket server.
 * US-8: Extended with multi-app WebSocket protocol tests.
 */

import { describe, test, expect } from 'bun:test';
import { RemoteServer } from './server.js';
import type { RalphConfig } from '../config/types.js';
import type { TrackerPlugin } from '../plugins/trackers/types.js';
import type {
  SubscribeMessage,
  EngineEventMessage,
  GetStateMessage,
  EvolutionEventMessage,
  ListAppsMessage,
  ListAppsResponseMessage,
  CreateAppMessage,
  AppCreatedMessage,
  RemoteEngineState,
  RemoteWSMessageType,
} from './types.js';
import type { AppCellOrchestrator } from '../platform/orchestrator.js';

/** Create a minimal mock config for testing */
function createMockConfig(): RalphConfig {
  return {
    cwd: '/tmp/test-project',
    maxIterations: 5,
    iterationDelay: 100,
    outputDir: '/tmp/output',
    progressFile: '/tmp/progress.md',
    sessionId: 'test-session',
    agent: { name: 'test-agent', plugin: 'claude', options: {} },
    tracker: { name: 'test-tracker', plugin: 'beads', options: {} },
    showTui: false,
    errorHandling: {
      strategy: 'skip',
      maxRetries: 3,
      retryDelayMs: 1000,
      continueOnNonZeroExit: false,
    },
  };
}

/** Create a minimal mock tracker for testing */
function createMockTracker(): TrackerPlugin {
  return {
    meta: {
      id: 'mock-tracker',
      name: 'Mock Tracker',
      description: 'A mock tracker for testing',
      version: '1.0.0',
      supportsBidirectionalSync: false,
      supportsHierarchy: false,
      supportsDependencies: true,
    },
    initialize: async () => {},
    isReady: async () => true,
    getTasks: async () => [],
    getTask: async () => undefined,
    getNextTask: async () => undefined,
    completeTask: async () => ({ success: true, message: 'Task completed' }),
    updateTaskStatus: async () => undefined,
    isComplete: async () => true,
    sync: async () => ({ success: true, message: 'Synced', syncedAt: new Date().toISOString() }),
    isTaskReady: async () => true,
    getEpics: async () => [],
    getSetupQuestions: () => [],
    validateSetup: async () => null,
    dispose: async () => {},
    getTemplate: () => 'Mock template',
  };
}

describe('RemoteServer', () => {
  describe('constructor', () => {
    test('creates instance with minimal options', () => {
      const server = new RemoteServer({
        port: 7890,
        hasToken: false,
      });

      expect(server).toBeInstanceOf(RemoteServer);
    });

    test('creates instance with hasToken true', () => {
      const server = new RemoteServer({
        port: 8080,
        hasToken: true,
        maxPortRetries: 5,
        cwd: '/tmp/test',
      });

      expect(server).toBeInstanceOf(RemoteServer);
    });
  });

  describe('setTracker', () => {
    test('sets tracker instance', () => {
      const server = new RemoteServer({ port: 7890, hasToken: false });
      const tracker = createMockTracker();

      // Should not throw
      server.setTracker(tracker);
    });
  });

  describe('setParallelConfig', () => {
    test('sets parallel config for orchestration', () => {
      const server = new RemoteServer({ port: 7890, hasToken: false });
      const config = createMockConfig();
      const tracker = createMockTracker();

      // Should not throw
      server.setParallelConfig({ baseConfig: config, tracker });
    });
  });

  describe('actualPort getter', () => {
    test('returns null when server not started', () => {
      const server = new RemoteServer({ port: 7890, hasToken: false });

      expect(server.actualPort).toBeNull();
    });
  });

  // ============================================================================
  // US-8: Multi-App Protocol Tests
  // ============================================================================

  describe('setOrchestrator (US-8)', () => {
    test('sets orchestrator instance without throwing', () => {
      const server = new RemoteServer({ port: 7890, hasToken: false });

      // Create a minimal mock orchestrator
      const mockOrchestrator = {
        on: () => () => {},
        getRunningApps: () => [],
        getAppStatus: async () => ({}),
        getRegistry: () => ({}),
      } as unknown as AppCellOrchestrator;

      // Should not throw
      server.setOrchestrator(mockOrchestrator);
    });

    test('can be called multiple times (replaces previous)', () => {
      const server = new RemoteServer({ port: 7890, hasToken: false });

      const mock1 = { on: () => () => {} } as unknown as AppCellOrchestrator;
      const mock2 = { on: () => () => {} } as unknown as AppCellOrchestrator;

      server.setOrchestrator(mock1);
      server.setOrchestrator(mock2);
    });
  });

  describe('constructor with orchestrator (US-8)', () => {
    test('accepts orchestrator option', () => {
      const mockOrchestrator = {
        on: () => () => {},
      } as unknown as AppCellOrchestrator;

      const server = new RemoteServer({
        port: 7890,
        hasToken: false,
        orchestrator: mockOrchestrator,
      });

      expect(server).toBeInstanceOf(RemoteServer);
    });
  });
});

// ============================================================================
// US-8: Multi-App Type Definition Tests
// ============================================================================

describe('US-8 Multi-App Message Types', () => {
  test('SubscribeMessage includes optional appId field', () => {
    const msg: SubscribeMessage = {
      type: 'subscribe',
      id: 'test-1',
      timestamp: new Date().toISOString(),
      eventTypes: ['engine:started'],
      appId: 'app-123',
    };
    expect(msg.appId).toBe('app-123');
    expect(msg.type).toBe('subscribe');
  });

  test('SubscribeMessage works without appId (backward compat)', () => {
    const msg: SubscribeMessage = {
      type: 'subscribe',
      id: 'test-2',
      timestamp: new Date().toISOString(),
    };
    expect(msg.appId).toBeUndefined();
  });

  test('SubscribeMessage accepts null appId (all apps)', () => {
    const msg: SubscribeMessage = {
      type: 'subscribe',
      id: 'test-3',
      timestamp: new Date().toISOString(),
      appId: null,
    };
    expect(msg.appId).toBeNull();
  });

  test('EngineEventMessage includes optional appId field', () => {
    const msg: EngineEventMessage = {
      type: 'engine_event',
      id: 'test-4',
      timestamp: new Date().toISOString(),
      event: { type: 'engine:started', timestamp: new Date().toISOString() } as EngineEventMessage['event'],
      appId: 'app-456',
    };
    expect(msg.appId).toBe('app-456');
  });

  test('EngineEventMessage works without appId (backward compat)', () => {
    const msg: EngineEventMessage = {
      type: 'engine_event',
      id: 'test-5',
      timestamp: new Date().toISOString(),
      event: { type: 'engine:started', timestamp: new Date().toISOString() } as EngineEventMessage['event'],
    };
    expect(msg.appId).toBeUndefined();
  });

  test('GetStateMessage includes optional appId field', () => {
    const msg: GetStateMessage = {
      type: 'get_state',
      id: 'test-6',
      timestamp: new Date().toISOString(),
      appId: 'app-789',
    };
    expect(msg.appId).toBe('app-789');
  });

  test('GetStateMessage works without appId (backward compat)', () => {
    const msg: GetStateMessage = {
      type: 'get_state',
      id: 'test-7',
      timestamp: new Date().toISOString(),
    };
    expect(msg.appId).toBeUndefined();
  });

  test('RemoteEngineState includes optional appId field', () => {
    const state: Partial<RemoteEngineState> = {
      appId: 'app-state-1',
      status: 'idle',
    };
    expect(state.appId).toBe('app-state-1');
  });

  test('EvolutionEventMessage includes optional appId field', () => {
    const msg: EvolutionEventMessage = {
      type: 'evolution_event',
      id: 'test-8',
      timestamp: new Date().toISOString(),
      event: { type: 'evolution:started', maxVersions: 5 },
      appId: 'app-evo-1',
    };
    expect(msg.appId).toBe('app-evo-1');
  });

  test('ListAppsMessage type structure', () => {
    const msg: ListAppsMessage = {
      type: 'list_apps',
      id: 'test-9',
      timestamp: new Date().toISOString(),
    };
    expect(msg.type).toBe('list_apps');
  });

  test('ListAppsResponseMessage type structure', () => {
    const msg: ListAppsResponseMessage = {
      type: 'list_apps_response',
      id: 'test-10',
      timestamp: new Date().toISOString(),
      success: true,
      apps: [],
    };
    expect(msg.success).toBe(true);
    expect(msg.apps).toEqual([]);
  });

  test('CreateAppMessage type structure', () => {
    const msg: CreateAppMessage = {
      type: 'create_app',
      id: 'test-11',
      timestamp: new Date().toISOString(),
      name: 'my-new-app',
      description: 'A test app',
      blueprintPath: '/path/to/blueprint.yaml',
    };
    expect(msg.name).toBe('my-new-app');
    expect(msg.description).toBe('A test app');
    expect(msg.blueprintPath).toBe('/path/to/blueprint.yaml');
  });

  test('AppCreatedMessage type structure', () => {
    const msg: AppCreatedMessage = {
      type: 'app_created',
      id: 'test-12',
      timestamp: new Date().toISOString(),
      success: true,
      appId: 'new-app-id',
      appName: 'my-new-app',
    };
    expect(msg.success).toBe(true);
    expect(msg.appId).toBe('new-app-id');
  });

  test('new types are included in RemoteWSMessageType union', () => {
    // Type-level test: these assignments should compile without error
    const listApps: RemoteWSMessageType = {
      type: 'list_apps',
      id: 'test',
      timestamp: new Date().toISOString(),
    } as ListAppsMessage;
    expect(listApps.type).toBe('list_apps');

    const createApp: RemoteWSMessageType = {
      type: 'create_app',
      id: 'test',
      timestamp: new Date().toISOString(),
      name: 'app',
    } as CreateAppMessage;
    expect(createApp.type).toBe('create_app');

    const listResponse: RemoteWSMessageType = {
      type: 'list_apps_response',
      id: 'test',
      timestamp: new Date().toISOString(),
      success: true,
    } as ListAppsResponseMessage;
    expect(listResponse.type).toBe('list_apps_response');

    const appCreated: RemoteWSMessageType = {
      type: 'app_created',
      id: 'test',
      timestamp: new Date().toISOString(),
      success: true,
    } as AppCreatedMessage;
    expect(appCreated.type).toBe('app_created');
  });
});
