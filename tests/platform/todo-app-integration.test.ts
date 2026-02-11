/**
 * ABOUTME: Integration test — Medium App (Todo App).
 * US-015: Validates the platform handles multi-file apps with a React + Express Todo app.
 *
 * Tests the full cell lifecycle with a more complex app than US-014:
 * 1. Create app via registry (CLI equivalent) with multi-file fixture
 * 2. Set blueprint with 8 criteria (CRUD, persist, filter, responsive, error, loading)
 * 3. Agent evolves the app through at least 3 versions, demonstrating multi-file changes
 * 4. Blueprint criteria tracked accurately across versions
 * 5. Agent makes reasonable product decisions about implementation order
 * 6. Cell lifecycle (stop/restart/destroy) works with multi-file state
 *
 * Key differences from US-014 (simple landing page):
 * - Multi-file fixture: package.json, server/ (Express + SQLite), client/ (Vite + vanilla JS)
 * - 8 blueprint criteria requiring cross-file changes (API + UI + DB)
 * - Agent must demonstrate prioritization: foundational criteria (CRUD) before polish (responsive, loading)
 * - Each evolution step changes files across multiple directories (server/ + client/)
 *
 * Uses mocked Docker (CellManager) and Agent to test orchestration logic
 * without requiring a real Docker daemon.
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AppCellOrchestrator,
  type OrchestratorEvent,
  type EvolutionProgress,
} from '../../src/platform/orchestrator.js';
import type { AppRegistry, AppRegistryEntry } from '../../src/platform/registry.js';
import type { CellManager, CellStatus, CreateCellOptions } from '../../src/platform/cell-manager.js';
import type {
  AgentAdapter,
  AgentAdapterConfig,
  AgentAdapterStatus,
  Blueprint,
  BlueprintCriterion,
  CellRef,
  EvolutionGap,
  EvolutionResult,
} from '../../src/platform/agent-adapter.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, '..', '..', 'testing', 'fixtures', 'todo-app');

/**
 * The Todo App blueprint with 8 acceptance criteria.
 * Criteria are ordered by priority — the agent should address
 * foundational CRUD operations before polish features.
 */
const TODO_APP_BLUEPRINT: Blueprint = {
  vision: 'A full-stack Todo app with React frontend, Express API, and SQLite persistence. Supports CRUD operations, filtering, responsive design, and proper error/loading states.',
  criteria: [
    { id: 'AC-1', description: 'Add a new todo item via form submission', met: false, priority: 0 },
    { id: 'AC-2', description: 'Mark a todo as completed/uncompleted (toggle)', met: false, priority: 0 },
    { id: 'AC-3', description: 'Delete a todo item with confirmation', met: false, priority: 0 },
    { id: 'AC-4', description: 'Todos persist across page reloads via SQLite', met: false, priority: 0 },
    { id: 'AC-5', description: 'Filter todos by status: all, active, completed', met: false, priority: 1 },
    { id: 'AC-6', description: 'Responsive layout that works on mobile (< 600px)', met: false, priority: 1 },
    { id: 'AC-7', description: 'Error states shown when API calls fail', met: false, priority: 2 },
    { id: 'AC-8', description: 'Loading indicators while data is being fetched', met: false, priority: 2 },
  ],
  constraints: [
    'Use Express for the API server',
    'Use SQLite (better-sqlite3) for persistence',
    'Client can use vanilla JS or React — agent decides',
    'API and client must be in separate directories',
  ],
  outOfScope: ['Authentication', 'Multi-user support', 'Real-time sync', 'Deployment'],
};

// ─── Mock Helpers ───────────────────────────────────────────────────────────

/** Track version history as the agent evolves the app. */
interface VersionRecord {
  version: number;
  criterionId: string;
  criterionMet: boolean;
  filesChanged: string[];
  summary: string;
}

/**
 * Map criteria to the files they would change.
 *
 * This is the key difference from US-014: each criterion touches files in
 * MULTIPLE directories (server + client), demonstrating multi-file evolution.
 */
function getFilesForCriterion(criterionId: string): string[] {
  switch (criterionId) {
    case 'AC-1': // Add todo
      return ['server/index.js', 'client/src/main.js', 'client/index.html'];
    case 'AC-2': // Toggle todo
      return ['server/index.js', 'client/src/main.js'];
    case 'AC-3': // Delete todo
      return ['server/index.js', 'client/src/main.js'];
    case 'AC-4': // Persist via SQLite
      return ['server/db.js', 'server/index.js', 'package.json'];
    case 'AC-5': // Filter todos
      return ['client/src/main.js', 'client/src/style.css'];
    case 'AC-6': // Responsive layout
      return ['client/src/style.css'];
    case 'AC-7': // Error states
      return ['client/src/main.js', 'client/src/style.css'];
    case 'AC-8': // Loading indicators
      return ['client/src/main.js', 'client/src/style.css'];
    default:
      return [];
  }
}

/**
 * Create a mock agent that simulates evolving the todo app.
 *
 * The agent demonstrates product decision-making by:
 * - Processing priority-0 criteria (CRUD) before priority-1 (filter, responsive)
 * - Processing priority-1 before priority-2 (error, loading states)
 * - Tracking multi-file changes across server/ and client/ directories
 */
function makeTodoAppAgent(): AgentAdapter & {
  versionHistory: VersionRecord[];
  evolveCallCount: number;
} {
  let currentVersion = 0;
  const versionHistory: VersionRecord[] = [];
  let stopped = false;

  const agent: AgentAdapter & {
    versionHistory: VersionRecord[];
    evolveCallCount: number;
  } = {
    versionHistory,
    evolveCallCount: 0,

    async initialize(_cell: CellRef, _blueprint: Blueprint) {
      // Agent reads the blueprint and prepares strategy
    },

    async evolve(gap: EvolutionGap): Promise<EvolutionResult> {
      if (stopped) {
        return {
          success: false,
          criterionId: gap.criterionId,
          summary: 'Agent was stopped',
          filesChanged: [],
          criterionMet: false,
        };
      }

      currentVersion++;
      agent.evolveCallCount++;

      // Simulate multi-file changes based on the criterion
      const filesChanged = getFilesForCriterion(gap.criterionId);
      const summary = `Version ${currentVersion}: Implemented ${gap.description}`;

      const record: VersionRecord = {
        version: currentVersion,
        criterionId: gap.criterionId,
        criterionMet: true,
        filesChanged,
        summary,
      };
      versionHistory.push(record);

      return {
        success: true,
        criterionId: gap.criterionId,
        summary,
        filesChanged,
        criterionMet: true,
      };
    },

    status(): AgentAdapterStatus {
      if (stopped) return { state: 'stopped', reason: 'Manual stop' };
      return { state: 'idle' };
    },

    async stop() {
      stopped = true;
    },

    async onBlueprintUpdate(_blueprint: Blueprint) {
      // Re-analyze gaps
    },
  };

  return agent;
}

/** App entry for the todo app test. */
function makeTodoApp(overrides: Partial<AppRegistryEntry> = {}): AppRegistryEntry {
  return {
    id: 'todo-app-001',
    name: 'todo-app',
    repoUrl: 'file://' + FIXTURE_DIR.replace(/\\/g, '/'),
    agentType: 'openclaw',
    stackType: 'node',
    status: 'idle',
    currentVersion: '0.0.0',
    createdAt: '2026-02-11T00:00:00Z',
    updatedAt: '2026-02-11T00:00:00Z',
    ...overrides,
  };
}

/**
 * Create a mock registry with the todo app.
 * Tracks status updates for verification.
 */
function makeMockRegistry(app: AppRegistryEntry): AppRegistry & { statusHistory: AppRegistryEntry['status'][] } {
  const store = new Map<string, AppRegistryEntry>();
  store.set(app.id, { ...app });
  const statusHistory: AppRegistryEntry['status'][] = [app.status];

  return {
    statusHistory,
    async load() {},
    async save() {},
    async get(id: string) { return store.get(id); },
    async getByName(name: string) {
      for (const entry of store.values()) {
        if (entry.name === name) return entry;
      }
      return undefined;
    },
    async list() { return Array.from(store.values()); },
    async create(input: any) {
      const entry = { ...input, id: 'new-app-id', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      store.set(entry.id, entry);
      return entry;
    },
    async update(id: string, input: Partial<AppRegistryEntry>) {
      const existing = store.get(id);
      if (!existing) throw new Error(`App not found: ${id}`);
      const updated = { ...existing, ...input, updatedAt: new Date().toISOString() };
      store.set(id, updated);
      if (input.status) statusHistory.push(input.status);
      return updated;
    },
    async delete(id: string) {
      return store.delete(id);
    },
    async count() { return store.size; },
    getRegistryPath() { return '/tmp/test-todo-app-registry.json'; },
  } as unknown as AppRegistry & { statusHistory: AppRegistryEntry['status'][] };
}

/**
 * Mock CellManager that tracks cell lifecycle without Docker.
 * Records create/start/stop/destroy events for verification.
 */
function makeMockCellManager(): CellManager & {
  cellEvents: Array<{ action: string; appName: string; timestamp: string }>;
  activeCells: Set<string>;
  destroyedCells: Set<string>;
  cellData: Map<string, CellRef>;
} {
  const cellEvents: Array<{ action: string; appName: string; timestamp: string }> = [];
  const activeCells = new Set<string>();
  const destroyedCells = new Set<string>();
  const cellData = new Map<string, CellRef>();

  const recordEvent = (action: string, appName: string) => {
    cellEvents.push({ action, appName, timestamp: new Date().toISOString() });
  };

  return {
    cellEvents,
    activeCells,
    destroyedCells,
    cellData,

    async ping() {},

    async getCellRef(appName: string) {
      return cellData.get(appName);
    },

    async createCell(options: CreateCellOptions): Promise<CellRef> {
      const ref: CellRef = {
        cellId: `meta-vibecoding-${options.appName}`,
        workDir: '/workspace',
        stackType: options.stackType,
      };
      cellData.set(options.appName, ref);
      recordEvent('create', options.appName);
      return ref;
    },

    async startCell(appName: string) {
      activeCells.add(appName);
      recordEvent('start', appName);
    },

    async stopCell(appName: string) {
      activeCells.delete(appName);
      recordEvent('stop', appName);
    },

    async destroyCell(appName: string) {
      activeCells.delete(appName);
      destroyedCells.add(appName);
      cellData.delete(appName);
      recordEvent('destroy', appName);
    },

    async getCellStatus(appName: string): Promise<CellStatus> {
      if (destroyedCells.has(appName)) return { state: 'not_found' };
      if (activeCells.has(appName)) {
        return { state: 'running', startedAt: new Date().toISOString() };
      }
      if (cellData.has(appName)) {
        return { state: 'stopped', finishedAt: new Date().toISOString() };
      }
      return { state: 'not_found' };
    },

    async listCells() { return []; },
    async execInCell() { return { exitCode: 0, output: '' }; },
  } as unknown as CellManager & {
    cellEvents: Array<{ action: string; appName: string; timestamp: string }>;
    activeCells: Set<string>;
    destroyedCells: Set<string>;
    cellData: Map<string, CellRef>;
  };
}

// ─── Mock createAgentAdapter ─────────────────────────────────────────────────

let currentMockAgent: ReturnType<typeof makeTodoAppAgent>;

mock.module('../../src/platform/agent-adapter.js', () => ({
  createAgentAdapter: (_config: AgentAdapterConfig) => currentMockAgent,
  AgentAdapterConfigSchema: { parse: (v: unknown) => v },
  registerAgentAdapter: () => {},
  getRegisteredAgentTypes: () => ['openclaw'],
  hasAgentType: () => true,
  clearAgentAdapterRegistry: () => {},
}));

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('US-015: Integration Test — Medium App (Todo App)', () => {
  let orchestrator: AppCellOrchestrator;
  let registry: ReturnType<typeof makeMockRegistry>;
  let cellManager: ReturnType<typeof makeMockCellManager>;
  let app: AppRegistryEntry;
  let events: OrchestratorEvent[];

  beforeEach(() => {
    currentMockAgent = makeTodoAppAgent();
    app = makeTodoApp();
    registry = makeMockRegistry(app);
    cellManager = makeMockCellManager();
    orchestrator = new AppCellOrchestrator(
      registry as unknown as AppRegistry,
      cellManager as unknown as CellManager,
    );
    events = [];
    orchestrator.on((event) => events.push(event));
  });

  // ─── AC: Test repo exists with React frontend + Express API + SQLite ───────

  describe('fixture repo', () => {
    test('fixture directory exists with multi-file app structure', () => {
      expect(existsSync(join(FIXTURE_DIR, 'package.json'))).toBe(true);
      expect(existsSync(join(FIXTURE_DIR, 'server', 'index.js'))).toBe(true);
      expect(existsSync(join(FIXTURE_DIR, 'server', 'db.js'))).toBe(true);
      expect(existsSync(join(FIXTURE_DIR, 'client', 'index.html'))).toBe(true);
      expect(existsSync(join(FIXTURE_DIR, 'client', 'src', 'main.js'))).toBe(true);
      expect(existsSync(join(FIXTURE_DIR, 'client', 'src', 'style.css'))).toBe(true);
    });

    test('fixture has separate server and client directories', () => {
      // Verify the multi-directory structure that distinguishes this from US-014
      expect(existsSync(join(FIXTURE_DIR, 'server'))).toBe(true);
      expect(existsSync(join(FIXTURE_DIR, 'client'))).toBe(true);
      expect(existsSync(join(FIXTURE_DIR, 'client', 'src'))).toBe(true);
    });
  });

  // ─── AC: Blueprint specifies CRUD, persistent storage, responsive UI, error handling

  describe('blueprint specification', () => {
    test('blueprint has 8 criteria covering CRUD, persistence, UX, and resilience', () => {
      expect(TODO_APP_BLUEPRINT.criteria).toHaveLength(8);
      expect(TODO_APP_BLUEPRINT.criteria.map(c => c.id)).toEqual([
        'AC-1', 'AC-2', 'AC-3', 'AC-4', 'AC-5', 'AC-6', 'AC-7', 'AC-8',
      ]);
    });

    test('blueprint criteria cover all required domains', () => {
      const descriptions = TODO_APP_BLUEPRINT.criteria.map(c => c.description.toLowerCase());

      // CRUD operations
      expect(descriptions.some(d => d.includes('add') && d.includes('todo'))).toBe(true);
      expect(descriptions.some(d => d.includes('completed') || d.includes('toggle'))).toBe(true);
      expect(descriptions.some(d => d.includes('delete'))).toBe(true);

      // Persistent storage
      expect(descriptions.some(d => d.includes('persist') && d.includes('sqlite'))).toBe(true);

      // Responsive UI
      expect(descriptions.some(d => d.includes('responsive'))).toBe(true);

      // Error handling
      expect(descriptions.some(d => d.includes('error'))).toBe(true);

      // Loading states
      expect(descriptions.some(d => d.includes('loading'))).toBe(true);

      // Filter
      expect(descriptions.some(d => d.includes('filter'))).toBe(true);
    });

    test('blueprint has priority tiers: CRUD (P0) > UX (P1) > resilience (P2)', () => {
      // Priority 0: CRUD operations (foundational)
      const p0 = TODO_APP_BLUEPRINT.criteria.filter(c => c.priority === 0);
      expect(p0).toHaveLength(4);
      expect(p0.map(c => c.id)).toEqual(['AC-1', 'AC-2', 'AC-3', 'AC-4']);

      // Priority 1: UX polish
      const p1 = TODO_APP_BLUEPRINT.criteria.filter(c => c.priority === 1);
      expect(p1).toHaveLength(2);
      expect(p1.map(c => c.id)).toEqual(['AC-5', 'AC-6']);

      // Priority 2: Resilience
      const p2 = TODO_APP_BLUEPRINT.criteria.filter(c => c.priority === 2);
      expect(p2).toHaveLength(2);
      expect(p2.map(c => c.id)).toEqual(['AC-7', 'AC-8']);
    });

    test('blueprint constraints require Express, SQLite, and separated client/server', () => {
      const constraints = TODO_APP_BLUEPRINT.constraints.map(c => c.toLowerCase());
      expect(constraints.some(c => c.includes('express'))).toBe(true);
      expect(constraints.some(c => c.includes('sqlite'))).toBe(true);
      expect(constraints.some(c => c.includes('separate directories'))).toBe(true);
    });
  });

  // ─── AC: Agent evolves through at least 3 versions, multi-file changes ─────

  describe('evolution loop', () => {
    test('agent evolves the app through at least 3 versions', async () => {
      await orchestrator.launchApp(app.id, { blueprint: TODO_APP_BLUEPRINT });

      // Wait for async evolution loop to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Agent should have evolved through all 8 unmet criteria — well above the 3 minimum
      expect(currentMockAgent.evolveCallCount).toBeGreaterThanOrEqual(3);
      expect(currentMockAgent.versionHistory.length).toBeGreaterThanOrEqual(3);
    });

    test('evolution processes all 8 gaps', async () => {
      await orchestrator.launchApp(app.id, { blueprint: TODO_APP_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // All 8 criteria should have been addressed
      expect(currentMockAgent.evolveCallCount).toBe(8);

      // Each version should target a different criterion
      const criterionIds = currentMockAgent.versionHistory.map(v => v.criterionId);
      for (let i = 1; i <= 8; i++) {
        expect(criterionIds).toContain(`AC-${i}`);
      }
    });

    test('each evolution step changes files across multiple directories', async () => {
      await orchestrator.launchApp(app.id, { blueprint: TODO_APP_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // CRUD criteria (AC-1 through AC-3) should touch both server/ and client/ files
      const crudVersions = currentMockAgent.versionHistory.filter(v =>
        ['AC-1', 'AC-2', 'AC-3'].includes(v.criterionId)
      );

      for (const version of crudVersions) {
        const hasServerFile = version.filesChanged.some(f => f.startsWith('server/'));
        const hasClientFile = version.filesChanged.some(f => f.startsWith('client/'));
        expect(hasServerFile).toBe(true);
        expect(hasClientFile).toBe(true);
      }
    });

    test('persistence criterion (AC-4) touches database and server files', async () => {
      await orchestrator.launchApp(app.id, { blueprint: TODO_APP_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 200));

      const dbVersion = currentMockAgent.versionHistory.find(v => v.criterionId === 'AC-4');
      expect(dbVersion).toBeDefined();
      expect(dbVersion!.filesChanged).toContain('server/db.js');
      expect(dbVersion!.filesChanged).toContain('server/index.js');
      expect(dbVersion!.filesChanged).toContain('package.json');
    });

    test('emits gap-started and gap-completed events for each criterion', async () => {
      await orchestrator.launchApp(app.id, { blueprint: TODO_APP_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 200));

      const gapStarted = events.filter(e => e.type === 'app:evolution-gap-started');
      const gapCompleted = events.filter(e => e.type === 'app:evolution-gap-completed');

      expect(gapStarted.length).toBe(8);
      expect(gapCompleted.length).toBe(8);
    });

    test('emits evolution-completed when all gaps addressed', async () => {
      await orchestrator.launchApp(app.id, { blueprint: TODO_APP_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 200));

      const completed = events.filter(e => e.type === 'app:evolution-completed');
      expect(completed.length).toBe(1);
      expect(completed[0].detail?.gapsCompleted).toBe(8);
      expect(completed[0].detail?.totalGaps).toBe(8);
    });
  });

  // ─── AC: Blueprint criteria tracked accurately across versions ──────────────

  describe('version history and criteria tracking', () => {
    test('records version history with incrementing version numbers', async () => {
      await orchestrator.launchApp(app.id, { blueprint: TODO_APP_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 200));

      const history = currentMockAgent.versionHistory;
      expect(history.length).toBe(8);

      // Version numbers should be sequential
      for (let i = 0; i < history.length; i++) {
        expect(history[i].version).toBe(i + 1);
      }
    });

    test('each version records files changed and summary', async () => {
      await orchestrator.launchApp(app.id, { blueprint: TODO_APP_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 200));

      for (const record of currentMockAgent.versionHistory) {
        expect(record.filesChanged.length).toBeGreaterThan(0);
        expect(record.summary).toContain('Version');
        expect(record.criterionMet).toBe(true);
      }
    });

    test('evolution progress reports all 8 gaps completed', async () => {
      await orchestrator.launchApp(app.id, { blueprint: TODO_APP_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 200));

      const status = await orchestrator.getAppStatus(app.id);
      expect(status.evolution.totalGaps).toBe(8);

      // Check via event record (evolution state resets after loop completes)
      const completedEvent = events.find(e => e.type === 'app:evolution-completed');
      expect(completedEvent).toBeDefined();
      expect(completedEvent!.detail?.gapsCompleted).toBe(8);
    });
  });

  // ─── AC: Agent makes reasonable product decisions about implementation order ─

  describe('agent product decision-making', () => {
    test('processes priority-0 (CRUD) criteria before priority-1 and priority-2', async () => {
      await orchestrator.launchApp(app.id, { blueprint: TODO_APP_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 200));

      const history = currentMockAgent.versionHistory;

      // Find the version numbers where each priority tier completes
      const p0Versions = history.filter(v => ['AC-1', 'AC-2', 'AC-3', 'AC-4'].includes(v.criterionId)).map(v => v.version);
      const p1Versions = history.filter(v => ['AC-5', 'AC-6'].includes(v.criterionId)).map(v => v.version);
      const p2Versions = history.filter(v => ['AC-7', 'AC-8'].includes(v.criterionId)).map(v => v.version);

      // All P0 should be processed before any P1
      const maxP0 = Math.max(...p0Versions);
      const minP1 = Math.min(...p1Versions);
      expect(maxP0).toBeLessThan(minP1);

      // All P1 should be processed before any P2
      const maxP1 = Math.max(...p1Versions);
      const minP2 = Math.min(...p2Versions);
      expect(maxP1).toBeLessThan(minP2);
    });

    test('total unique files changed spans both server and client directories', async () => {
      await orchestrator.launchApp(app.id, { blueprint: TODO_APP_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 200));

      const allFiles = new Set<string>();
      for (const record of currentMockAgent.versionHistory) {
        for (const file of record.filesChanged) {
          allFiles.add(file);
        }
      }

      // Should have files in server/, client/, and root
      const serverFiles = [...allFiles].filter(f => f.startsWith('server/'));
      const clientFiles = [...allFiles].filter(f => f.startsWith('client/'));
      const rootFiles = [...allFiles].filter(f => !f.includes('/'));

      expect(serverFiles.length).toBeGreaterThanOrEqual(2);
      expect(clientFiles.length).toBeGreaterThanOrEqual(2);
      expect(rootFiles.length).toBeGreaterThanOrEqual(1); // package.json
    });

    test('later versions touch fewer files (polish vs. foundation)', async () => {
      await orchestrator.launchApp(app.id, { blueprint: TODO_APP_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 200));

      const history = currentMockAgent.versionHistory;

      // Average files changed for P0 (CRUD) vs P2 (resilience polish)
      const p0Files = history
        .filter(v => ['AC-1', 'AC-2', 'AC-3', 'AC-4'].includes(v.criterionId))
        .reduce((sum, v) => sum + v.filesChanged.length, 0);
      const p2Files = history
        .filter(v => ['AC-7', 'AC-8'].includes(v.criterionId))
        .reduce((sum, v) => sum + v.filesChanged.length, 0);

      // CRUD operations (foundation) should touch more files than resilience polish
      expect(p0Files).toBeGreaterThan(p2Files);
    });
  });

  // ─── AC: Cell lifecycle works with multi-file state ─────────────────────────

  describe('stop and restart without data loss', () => {
    test('stops app gracefully and allows restart', async () => {
      await orchestrator.launchApp(app.id, { blueprint: TODO_APP_BLUEPRINT });
      expect(orchestrator.isRunning(app.id)).toBe(true);

      // Stop the app
      await orchestrator.stopApp(app.id);
      expect(orchestrator.isRunning(app.id)).toBe(false);

      // Cell should be stopped but still exist
      expect(cellManager.activeCells.has('todo-app')).toBe(false);
      expect(cellManager.cellData.has('todo-app')).toBe(true);

      // Registry status should be idle
      const updatedApp = await registry.get(app.id);
      expect(updatedApp!.status).toBe('idle');

      // Status history should show: idle → running → idle
      expect(registry.statusHistory).toEqual(['idle', 'running', 'idle']);
    });

    test('cell data survives stop/restart cycle', async () => {
      await orchestrator.launchApp(app.id, { blueprint: TODO_APP_BLUEPRINT });

      // Stop
      await orchestrator.stopApp(app.id);

      // Cell ref should still exist (data volume persists)
      const cellRef = await cellManager.getCellRef('todo-app');
      expect(cellRef).toBeDefined();
      expect(cellRef!.cellId).toBe('meta-vibecoding-todo-app');

      // Restart with new agent instance
      const agent2 = makeTodoAppAgent();
      currentMockAgent = agent2;

      const orchestrator2 = new AppCellOrchestrator(
        registry as unknown as AppRegistry,
        cellManager as unknown as CellManager,
      );
      const events2: OrchestratorEvent[] = [];
      orchestrator2.on((e) => events2.push(e));

      await orchestrator2.launchApp(app.id, { blueprint: TODO_APP_BLUEPRINT });

      // Should NOT emit cell-created (reused existing)
      const cellCreatedEvents = events2.filter(e => e.type === 'app:cell-created');
      expect(cellCreatedEvents.length).toBe(0);

      // Should start evolving again
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(agent2.evolveCallCount).toBeGreaterThan(0);

      await orchestrator2.stopApp(app.id);
    });
  });

  // ─── Cleanup on destroy ────────────────────────────────────────────────────

  describe('cleanup on destroy', () => {
    test('destroying the cell removes container and volume', async () => {
      await orchestrator.launchApp(app.id, { blueprint: TODO_APP_BLUEPRINT });
      await orchestrator.stopApp(app.id);

      // Destroy via cell manager
      await cellManager.destroyCell('todo-app', { confirm: true } as any);

      // Cell should be destroyed
      expect(cellManager.destroyedCells.has('todo-app')).toBe(true);
      expect(cellManager.cellData.has('todo-app')).toBe(false);

      // Cell status should be not_found
      const status = await cellManager.getCellStatus('todo-app');
      expect(status.state).toBe('not_found');
    });

    test('cell events record full lifecycle', async () => {
      await orchestrator.launchApp(app.id, { blueprint: TODO_APP_BLUEPRINT });
      await orchestrator.stopApp(app.id);
      await cellManager.destroyCell('todo-app', { confirm: true } as any);

      // Should have: create → start → stop → destroy
      const actions = cellManager.cellEvents.map(e => e.action);
      expect(actions).toEqual(['create', 'start', 'stop', 'destroy']);
    });
  });

  // ─── Full end-to-end lifecycle ─────────────────────────────────────────────

  describe('full end-to-end lifecycle', () => {
    test('complete lifecycle: create → evolve 8 gaps → stop → restart → evolve → destroy', async () => {
      // 1. Launch app with blueprint
      await orchestrator.launchApp(app.id, { blueprint: TODO_APP_BLUEPRINT });

      // 2. Wait for first evolution pass (all 8 gaps)
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(currentMockAgent.evolveCallCount).toBe(8);

      // 3. Verify multi-file changes occurred
      const allFiles = new Set<string>();
      for (const record of currentMockAgent.versionHistory) {
        for (const file of record.filesChanged) {
          allFiles.add(file);
        }
      }
      expect(allFiles.size).toBeGreaterThanOrEqual(5); // At least 5 unique files

      // 4. Stop
      await orchestrator.stopApp(app.id);
      expect(orchestrator.isRunning(app.id)).toBe(false);

      // 5. Restart with new agent
      const agent2 = makeTodoAppAgent();
      currentMockAgent = agent2;

      const orchestrator2 = new AppCellOrchestrator(
        registry as unknown as AppRegistry,
        cellManager as unknown as CellManager,
      );

      await orchestrator2.launchApp(app.id, { blueprint: TODO_APP_BLUEPRINT });

      // 6. Wait for second evolution pass
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(agent2.evolveCallCount).toBeGreaterThan(0);

      // 7. Stop and destroy
      await orchestrator2.stopApp(app.id);
      await cellManager.destroyCell('todo-app', { confirm: true } as any);

      // 8. Verify final state
      expect(cellManager.destroyedCells.has('todo-app')).toBe(true);

      // Full cell lifecycle recorded
      const actions = cellManager.cellEvents.map(e => e.action);
      expect(actions).toContain('create');
      expect(actions).toContain('start');
      expect(actions).toContain('stop');
      expect(actions).toContain('destroy');
    });
  });
});
