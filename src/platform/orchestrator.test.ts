/**
 * ABOUTME: Tests for AppCellOrchestrator — the central coordinator
 * for the Meta-Vibecoding platform lifecycle.
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import {
  AppCellOrchestrator,
  AppNotFoundError,
  AppAlreadyRunningError,
  AppNotRunningError,
  NoBlueprintError,
  type OrchestratorEvent,
} from './orchestrator.js';
import type { AppRegistry, AppRegistryEntry } from './registry.js';
import type { CellManager, CellStatus, CreateCellOptions } from './cell-manager.js';
import type {
  AgentAdapter,
  AgentAdapterConfig,
  AgentAdapterStatus,
  Blueprint,
  CellRef,
  EvolutionGap,
  EvolutionResult,
} from './agent-adapter.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeCellRef(appName = 'test-app'): CellRef {
  return {
    cellId: `meta-vibecoding-${appName}`,
    workDir: '/workspace',
    stackType: 'node',
  };
}

function makeBlueprint(unmetCount = 2): Blueprint {
  return {
    vision: 'A test application',
    criteria: [
      { id: 'AC-1', description: 'Has a landing page', met: false, priority: 0 },
      { id: 'AC-2', description: 'Responsive CSS', met: false, priority: 1 },
      { id: 'AC-3', description: 'Already done criterion', met: true, priority: 2 },
    ].slice(0, unmetCount + 1),
    constraints: ['Use TypeScript'],
    outOfScope: ['Mobile app'],
  };
}

function makeAppEntry(overrides: Partial<AppRegistryEntry> = {}): AppRegistryEntry {
  return {
    id: 'app-uuid-1',
    name: 'test-app',
    repoUrl: 'https://github.com/test/app',
    agentType: 'openclaw',
    stackType: 'node',
    status: 'idle',
    currentVersion: '0.0.0',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeMockAgent(): AgentAdapter & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {
    initialize: [],
    evolve: [],
    stop: [],
    onBlueprintUpdate: [],
  };

  return {
    calls,
    async initialize(cell: CellRef, blueprint: Blueprint) {
      calls.initialize.push([cell, blueprint]);
    },
    async evolve(gap: EvolutionGap): Promise<EvolutionResult> {
      calls.evolve.push([gap]);
      return {
        success: true,
        criterionId: gap.criterionId,
        summary: `Completed: ${gap.description}`,
        filesChanged: ['src/index.ts'],
        criterionMet: true,
      };
    },
    status(): AgentAdapterStatus {
      return { state: 'idle' };
    },
    async stop() {
      calls.stop.push([]);
    },
    async onBlueprintUpdate(blueprint: Blueprint) {
      calls.onBlueprintUpdate.push([blueprint]);
    },
  };
}

function makeMockRegistry(app?: AppRegistryEntry): AppRegistry {
  const store = new Map<string, AppRegistryEntry>();
  if (app) store.set(app.id, app);

  return {
    async get(id: string) { return store.get(id); },
    async update(id: string, input: Partial<AppRegistryEntry>) {
      const existing = store.get(id);
      if (!existing) throw new Error(`App not found: ${id}`);
      const updated = { ...existing, ...input, updatedAt: new Date().toISOString() };
      store.set(id, updated);
      return updated;
    },
    // Minimal stubs for unused methods
    async load() {},
    async save() {},
    async create() { return makeAppEntry(); },
    async getByName() { return undefined; },
    async list() { return Array.from(store.values()); },
    async delete() { return false; },
    async count() { return store.size; },
    getRegistryPath() { return '/tmp/test-registry.json'; },
  } as unknown as AppRegistry;
}

function makeMockCellManager(existingRef?: CellRef): CellManager {
  const started = new Set<string>();
  const stopped = new Set<string>();

  return {
    async getCellRef(_appName: string) { return existingRef ?? undefined; },
    async createCell(options: CreateCellOptions): Promise<CellRef> {
      return {
        cellId: `meta-vibecoding-${options.appName}`,
        workDir: '/workspace',
        stackType: options.stackType,
      };
    },
    async startCell(appName: string) {
      started.add(appName);
    },
    async stopCell(appName: string) {
      stopped.add(appName);
    },
    async getCellStatus(appName: string): Promise<CellStatus> {
      if (started.has(appName) && !stopped.has(appName)) {
        return { state: 'running', startedAt: new Date().toISOString() };
      }
      return { state: 'stopped', finishedAt: new Date().toISOString() };
    },
    // Minimal stubs
    async ping() {},
    async destroyCell() {},
    async listCells() { return []; },
    async execInCell() { return { exitCode: 0, output: '' }; },
  } as unknown as CellManager;
}

// ─── Mock createAgentAdapter ─────────────────────────────────────────────────

let mockAgent: ReturnType<typeof makeMockAgent>;

// We need to mock the module-level createAgentAdapter function.
// In the test, we'll intercept it via the factory registration approach.
// Since AppCellOrchestrator uses createAgentAdapter from agent-adapter.js,
// we'll mock that module.
mock.module('./agent-adapter.js', () => ({
  createAgentAdapter: (_config: AgentAdapterConfig) => mockAgent,
  // Re-export other things the orchestrator imports
  AgentAdapterConfigSchema: { parse: (v: unknown) => v },
  registerAgentAdapter: () => {},
  getRegisteredAgentTypes: () => ['openclaw'],
  hasAgentType: () => true,
  clearAgentAdapterRegistry: () => {},
}));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AppCellOrchestrator', () => {
  let orchestrator: AppCellOrchestrator;
  let registry: AppRegistry;
  let cellManager: CellManager;
  let app: AppRegistryEntry;
  let events: OrchestratorEvent[];

  beforeEach(() => {
    mockAgent = makeMockAgent();
    app = makeAppEntry();
    registry = makeMockRegistry(app);
    cellManager = makeMockCellManager();
    orchestrator = new AppCellOrchestrator(registry, cellManager);
    events = [];
    orchestrator.on((event) => events.push(event));
  });

  describe('launchApp', () => {
    it('should throw AppNotFoundError for unknown app ID', async () => {
      await expect(
        orchestrator.launchApp('nonexistent-id', { blueprint: makeBlueprint() })
      ).rejects.toThrow(AppNotFoundError);
    });

    it('should throw NoBlueprintError when no blueprint provided', async () => {
      await expect(
        orchestrator.launchApp(app.id)
      ).rejects.toThrow(NoBlueprintError);
    });

    it('should throw AppAlreadyRunningError on double launch', async () => {
      const blueprint = makeBlueprint();
      await orchestrator.launchApp(app.id, { blueprint });

      await expect(
        orchestrator.launchApp(app.id, { blueprint })
      ).rejects.toThrow(AppAlreadyRunningError);
    });

    it('should create cell, assign agent, and start evolution', async () => {
      const blueprint = makeBlueprint();
      await orchestrator.launchApp(app.id, { blueprint });

      // Agent should be initialized
      expect(mockAgent.calls.initialize.length).toBe(1);
      const [cellArg, bpArg] = mockAgent.calls.initialize[0] as [CellRef, Blueprint];
      expect(cellArg.workDir).toBe('/workspace');
      expect(bpArg.vision).toBe('A test application');

      // Should be listed as running
      expect(orchestrator.isRunning(app.id)).toBe(true);
      expect(orchestrator.getRunningApps()).toContain(app.id);
    });

    it('should emit lifecycle events', async () => {
      const blueprint = makeBlueprint();
      await orchestrator.launchApp(app.id, { blueprint });

      // Wait for evolution loop to process
      await new Promise((resolve) => setTimeout(resolve, 50));

      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain('app:cell-created');
      expect(eventTypes).toContain('app:agent-assigned');
      expect(eventTypes).toContain('app:registered');
      expect(eventTypes).toContain('app:evolution-started');
    });

    it('should reuse existing cell if available', async () => {
      const existingRef = makeCellRef();
      const cmWithRef = makeMockCellManager(existingRef);
      orchestrator = new AppCellOrchestrator(registry, cmWithRef);
      orchestrator.on((event) => events.push(event));

      await orchestrator.launchApp(app.id, { blueprint: makeBlueprint() });

      // Should NOT emit cell-created (reused existing)
      const cellCreatedEvents = events.filter((e) => e.type === 'app:cell-created');
      expect(cellCreatedEvents.length).toBe(0);
    });

    it('should run evolution loop and complete gaps', async () => {
      const blueprint = makeBlueprint(2);
      await orchestrator.launchApp(app.id, { blueprint });

      // Wait for the async evolution loop to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Agent.evolve should have been called for unmet criteria
      expect(mockAgent.calls.evolve.length).toBe(2);

      // Check evolution completed event
      const completedEvents = events.filter((e) => e.type === 'app:evolution-completed');
      expect(completedEvents.length).toBe(1);
      expect(completedEvents[0].detail?.gapsCompleted).toBe(2);
    });
  });

  describe('stopApp', () => {
    it('should throw AppNotRunningError for non-running app', async () => {
      await expect(
        orchestrator.stopApp(app.id)
      ).rejects.toThrow(AppNotRunningError);
    });

    it('should stop agent, stop cell, update registry, and remove from running', async () => {
      await orchestrator.launchApp(app.id, { blueprint: makeBlueprint() });
      expect(orchestrator.isRunning(app.id)).toBe(true);

      await orchestrator.stopApp(app.id);

      // Agent should be stopped
      expect(mockAgent.calls.stop.length).toBe(1);

      // Should no longer be running
      expect(orchestrator.isRunning(app.id)).toBe(false);
      expect(orchestrator.getRunningApps()).not.toContain(app.id);

      // Events
      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain('app:stopping');
      expect(eventTypes).toContain('app:stopped');
    });
  });

  describe('getAppStatus', () => {
    it('should throw AppNotFoundError for unknown app', async () => {
      await expect(
        orchestrator.getAppStatus('nonexistent-id')
      ).rejects.toThrow(AppNotFoundError);
    });

    it('should return idle status for non-running app', async () => {
      const status = await orchestrator.getAppStatus(app.id);

      expect(status.appId).toBe(app.id);
      expect(status.appName).toBe('test-app');
      expect(status.agent.state).toBe('idle');
      expect(status.evolution.running).toBe(false);
    });

    it('should return combined status for running app', async () => {
      await orchestrator.launchApp(app.id, { blueprint: makeBlueprint() });

      const status = await orchestrator.getAppStatus(app.id);

      expect(status.appId).toBe(app.id);
      expect(status.appName).toBe('test-app');
      expect(status.evolution.totalGaps).toBe(2);
    });
  });

  describe('concurrent apps', () => {
    it('should support multiple apps running simultaneously', async () => {
      const app2 = makeAppEntry({ id: 'app-uuid-2', name: 'second-app' });
      registry = makeMockRegistry(app);
      // Add second app to registry
      (registry as unknown as { _addApp: (a: AppRegistryEntry) => void })._addApp?.(app2);
      // Re-create with both apps
      const store = new Map<string, AppRegistryEntry>();
      store.set(app.id, app);
      store.set(app2.id, app2);
      registry = {
        async get(id: string) { return store.get(id); },
        async update(id: string, input: Partial<AppRegistryEntry>) {
          const existing = store.get(id);
          if (!existing) throw new Error(`App not found: ${id}`);
          const updated = { ...existing, ...input, updatedAt: new Date().toISOString() };
          store.set(id, updated);
          return updated;
        },
        async load() {},
        async save() {},
        async create() { return makeAppEntry(); },
        async getByName() { return undefined; },
        async list() { return Array.from(store.values()); },
        async delete() { return false; },
        async count() { return store.size; },
        getRegistryPath() { return '/tmp/test-registry.json'; },
      } as unknown as AppRegistry;

      orchestrator = new AppCellOrchestrator(registry, cellManager);

      await orchestrator.launchApp(app.id, { blueprint: makeBlueprint() });
      await orchestrator.launchApp(app2.id, { blueprint: makeBlueprint() });

      expect(orchestrator.getRunningApps()).toHaveLength(2);
      expect(orchestrator.isRunning(app.id)).toBe(true);
      expect(orchestrator.isRunning(app2.id)).toBe(true);

      await orchestrator.stopApp(app.id);
      expect(orchestrator.getRunningApps()).toHaveLength(1);
      expect(orchestrator.isRunning(app2.id)).toBe(true);
    });
  });

  describe('event system', () => {
    it('should allow unsubscribing from events', async () => {
      const localEvents: OrchestratorEvent[] = [];
      const unsub = orchestrator.on((e) => localEvents.push(e));

      await orchestrator.launchApp(app.id, { blueprint: makeBlueprint() });
      const countBefore = localEvents.length;

      unsub();

      await orchestrator.stopApp(app.id);
      // No new events should be received after unsubscribe
      expect(localEvents.length).toBe(countBefore);
    });

    it('should not break on listener errors', async () => {
      orchestrator.on(() => { throw new Error('bad listener'); });

      // Should not throw
      await orchestrator.launchApp(app.id, { blueprint: makeBlueprint() });
      expect(orchestrator.isRunning(app.id)).toBe(true);
    });
  });

  describe('evolution loop error handling', () => {
    it('should emit gap-failed and continue on agent.evolve() error', async () => {
      // Make agent throw on first evolve call
      let callCount = 0;
      mockAgent.evolve = async (gap: EvolutionGap): Promise<EvolutionResult> => {
        callCount++;
        if (callCount === 1) throw new Error('Agent crashed');
        return {
          success: true,
          criterionId: gap.criterionId,
          summary: 'OK',
          filesChanged: [],
          criterionMet: true,
        };
      };

      await orchestrator.launchApp(app.id, { blueprint: makeBlueprint(2) });

      // Wait for loop to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      const failedEvents = events.filter((e) => e.type === 'app:evolution-gap-failed');
      expect(failedEvents.length).toBe(1);
      expect(failedEvents[0].detail?.error).toBe('Agent crashed');

      // Second gap should still have been attempted
      expect(callCount).toBe(2);
    });

    it('should emit gap-failed for unsuccessful evolution results', async () => {
      mockAgent.evolve = async (gap: EvolutionGap): Promise<EvolutionResult> => ({
        success: false,
        criterionId: gap.criterionId,
        summary: 'Tool failed',
        filesChanged: [],
        criterionMet: false,
      });

      await orchestrator.launchApp(app.id, { blueprint: makeBlueprint(2) });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const failedEvents = events.filter((e) => e.type === 'app:evolution-gap-failed');
      expect(failedEvents.length).toBe(2);
    });
  });
});
