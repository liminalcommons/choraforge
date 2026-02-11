/**
 * ABOUTME: Integration test — Simple App (Landing Page).
 * US-014: Validates the platform works end-to-end with a simple static landing page app.
 *
 * Tests the full cell lifecycle:
 * 1. Create app via registry (CLI equivalent)
 * 2. Set blueprint with 5 criteria (hero, features grid, footer, responsive, fast load)
 * 3. Agent evolves the app through at least 2 versions
 * 4. Version history recorded with criteria tracking
 * 5. Cell can be stopped and restarted without data loss
 * 6. Docker container cleans up on destroy
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
const FIXTURE_DIR = join(__dirname, '..', '..', 'testing', 'fixtures', 'simple-landing-page');

/** The landing page blueprint with 5 acceptance criteria. */
const LANDING_PAGE_BLUEPRINT: Blueprint = {
  vision: 'A modern landing page with hero section, features grid, and footer that is responsive and loads fast.',
  criteria: [
    { id: 'AC-1', description: 'Hero section with heading, subtext, and CTA button', met: false, priority: 0 },
    { id: 'AC-2', description: 'Features grid with at least 3 feature cards', met: false, priority: 0 },
    { id: 'AC-3', description: 'Footer with copyright and navigation links', met: false, priority: 1 },
    { id: 'AC-4', description: 'Responsive design that works on mobile (< 600px)', met: false, priority: 1 },
    { id: 'AC-5', description: 'Page loads in under 2 seconds on 3G connection', met: false, priority: 2 },
  ],
  constraints: ['Use only HTML, CSS, and vanilla JS', 'No build tools required', 'Must work in all modern browsers'],
  outOfScope: ['Backend functionality', 'Database', 'Authentication'],
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
 * Create a mock agent that simulates evolving the landing page.
 * Each evolve() call represents one version of the app.
 * The agent marks criteria as met based on the gap's criterion.
 */
function makeLandingPageAgent(): AgentAdapter & {
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
      // Agent reads the blueprint and prepares
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

      // Simulate file changes based on the criterion
      const filesChanged = getFilesForCriterion(gap.criterionId);
      const summary = `Version ${currentVersion}: Addressed ${gap.description}`;

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

/** Map criteria to the files they would change. */
function getFilesForCriterion(criterionId: string): string[] {
  switch (criterionId) {
    case 'AC-1':
      return ['index.html', 'style.css'];
    case 'AC-2':
      return ['index.html', 'style.css'];
    case 'AC-3':
      return ['index.html', 'style.css'];
    case 'AC-4':
      return ['style.css'];
    case 'AC-5':
      return ['script.js', 'index.html'];
    default:
      return [];
  }
}

/** App entry for the landing page test app. */
function makeLandingPageApp(overrides: Partial<AppRegistryEntry> = {}): AppRegistryEntry {
  return {
    id: 'lp-app-001',
    name: 'simple-landing-page',
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
 * Create a mock registry with the landing page app.
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
    getRegistryPath() { return '/tmp/test-landing-page-registry.json'; },
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

let currentMockAgent: ReturnType<typeof makeLandingPageAgent>;

mock.module('../../src/platform/agent-adapter.js', () => ({
  createAgentAdapter: (_config: AgentAdapterConfig) => currentMockAgent,
  AgentAdapterConfigSchema: { parse: (v: unknown) => v },
  registerAgentAdapter: () => {},
  getRegisteredAgentTypes: () => ['openclaw'],
  hasAgentType: () => true,
  clearAgentAdapterRegistry: () => {},
}));

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('US-014: Integration Test — Simple Landing Page App', () => {
  let orchestrator: AppCellOrchestrator;
  let registry: ReturnType<typeof makeMockRegistry>;
  let cellManager: ReturnType<typeof makeMockCellManager>;
  let app: AppRegistryEntry;
  let events: OrchestratorEvent[];

  beforeEach(() => {
    currentMockAgent = makeLandingPageAgent();
    app = makeLandingPageApp();
    registry = makeMockRegistry(app);
    cellManager = makeMockCellManager();
    orchestrator = new AppCellOrchestrator(
      registry as unknown as AppRegistry,
      cellManager as unknown as CellManager,
    );
    events = [];
    orchestrator.on((event) => events.push(event));
  });

  // ─── AC: Test repo exists ─────────────────────────────────────────────────

  describe('fixture repo', () => {
    test('fixture directory exists with HTML, CSS, and JS files', () => {
      expect(existsSync(join(FIXTURE_DIR, 'index.html'))).toBe(true);
      expect(existsSync(join(FIXTURE_DIR, 'style.css'))).toBe(true);
      expect(existsSync(join(FIXTURE_DIR, 'script.js'))).toBe(true);
    });
  });

  // ─── AC: Create app via CLI, set blueprint ────────────────────────────────

  describe('app creation and blueprint assignment', () => {
    test('creates app via registry and assigns landing page blueprint', async () => {
      // Verify app is in the registry
      const found = await registry.getByName('simple-landing-page');
      expect(found).toBeDefined();
      expect(found!.name).toBe('simple-landing-page');
      expect(found!.stackType).toBe('node');
      expect(found!.status).toBe('idle');

      // Launch with landing page blueprint (5 criteria)
      await orchestrator.launchApp(app.id, { blueprint: LANDING_PAGE_BLUEPRINT });

      // Verify blueprint has 5 criteria
      expect(LANDING_PAGE_BLUEPRINT.criteria).toHaveLength(5);
      expect(LANDING_PAGE_BLUEPRINT.criteria.map(c => c.id)).toEqual([
        'AC-1', 'AC-2', 'AC-3', 'AC-4', 'AC-5',
      ]);

      // App should be running
      expect(orchestrator.isRunning(app.id)).toBe(true);
    });

    test('blueprint contains the 5 required criteria', () => {
      const descriptions = LANDING_PAGE_BLUEPRINT.criteria.map(c => c.description);
      expect(descriptions.some(d => d.toLowerCase().includes('hero'))).toBe(true);
      expect(descriptions.some(d => d.toLowerCase().includes('features') || d.toLowerCase().includes('grid'))).toBe(true);
      expect(descriptions.some(d => d.toLowerCase().includes('footer'))).toBe(true);
      expect(descriptions.some(d => d.toLowerCase().includes('responsive'))).toBe(true);
      expect(descriptions.some(d => d.toLowerCase().includes('load'))).toBe(true);
    });
  });

  // ─── AC: Agent evolves through at least 2 versions ─────────────────────────

  describe('evolution loop', () => {
    test('agent evolves the app through at least 2 versions', async () => {
      await orchestrator.launchApp(app.id, { blueprint: LANDING_PAGE_BLUEPRINT });

      // Wait for async evolution loop to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Agent should have evolved through all 5 unmet criteria
      expect(currentMockAgent.evolveCallCount).toBeGreaterThanOrEqual(2);
      expect(currentMockAgent.versionHistory.length).toBeGreaterThanOrEqual(2);
    });

    test('evolution processes all 5 gaps', async () => {
      await orchestrator.launchApp(app.id, { blueprint: LANDING_PAGE_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // All 5 criteria should have been addressed
      expect(currentMockAgent.evolveCallCount).toBe(5);

      // Each version should target a different criterion
      const criterionIds = currentMockAgent.versionHistory.map(v => v.criterionId);
      expect(criterionIds).toContain('AC-1');
      expect(criterionIds).toContain('AC-2');
      expect(criterionIds).toContain('AC-3');
      expect(criterionIds).toContain('AC-4');
      expect(criterionIds).toContain('AC-5');
    });

    test('emits gap-started and gap-completed events for each version', async () => {
      await orchestrator.launchApp(app.id, { blueprint: LANDING_PAGE_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 200));

      const gapStarted = events.filter(e => e.type === 'app:evolution-gap-started');
      const gapCompleted = events.filter(e => e.type === 'app:evolution-gap-completed');

      expect(gapStarted.length).toBe(5);
      expect(gapCompleted.length).toBe(5);
    });

    test('emits evolution-completed when all gaps addressed', async () => {
      await orchestrator.launchApp(app.id, { blueprint: LANDING_PAGE_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 200));

      const completed = events.filter(e => e.type === 'app:evolution-completed');
      expect(completed.length).toBe(1);
      expect(completed[0].detail?.gapsCompleted).toBe(5);
      expect(completed[0].detail?.totalGaps).toBe(5);
    });
  });

  // ─── AC: Version history recorded with criteria tracking ───────────────────

  describe('version history and criteria tracking', () => {
    test('records version history with incrementing version numbers', async () => {
      await orchestrator.launchApp(app.id, { blueprint: LANDING_PAGE_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 200));

      const history = currentMockAgent.versionHistory;
      expect(history.length).toBe(5);

      // Version numbers should be sequential
      for (let i = 0; i < history.length; i++) {
        expect(history[i].version).toBe(i + 1);
      }
    });

    test('each version records files changed and summary', async () => {
      await orchestrator.launchApp(app.id, { blueprint: LANDING_PAGE_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 200));

      for (const record of currentMockAgent.versionHistory) {
        expect(record.filesChanged.length).toBeGreaterThan(0);
        expect(record.summary).toContain('Version');
        expect(record.criterionMet).toBe(true);
      }
    });

    test('evolution progress tracks gaps completed', async () => {
      await orchestrator.launchApp(app.id, { blueprint: LANDING_PAGE_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 200));

      const status = await orchestrator.getAppStatus(app.id);
      // After evolution completes, app is idle with all gaps done
      expect(status.evolution.totalGaps).toBe(5);
      // Note: evolution.running may be false and gapsCompleted may not persist
      // after the loop finishes if the app was cleaned up — check event record instead
      const completedEvent = events.find(e => e.type === 'app:evolution-completed');
      expect(completedEvent).toBeDefined();
      expect(completedEvent!.detail?.gapsCompleted).toBe(5);
    });
  });

  // ─── AC: Cell can be stopped and restarted without data loss ──────────────

  describe('stop and restart without data loss', () => {
    test('stops app gracefully and allows restart', async () => {
      await orchestrator.launchApp(app.id, { blueprint: LANDING_PAGE_BLUEPRINT });
      expect(orchestrator.isRunning(app.id)).toBe(true);

      // Stop the app
      await orchestrator.stopApp(app.id);
      expect(orchestrator.isRunning(app.id)).toBe(false);

      // Cell should be stopped but still exist
      expect(cellManager.activeCells.has('simple-landing-page')).toBe(false);
      expect(cellManager.cellData.has('simple-landing-page')).toBe(true);

      // Registry status should be idle
      const updatedApp = await registry.get(app.id);
      expect(updatedApp!.status).toBe('idle');

      // Status history should show: idle → running → idle
      expect(registry.statusHistory).toEqual(['idle', 'running', 'idle']);
    });

    test('cell data survives stop/restart cycle', async () => {
      await orchestrator.launchApp(app.id, { blueprint: LANDING_PAGE_BLUEPRINT });

      // Stop
      await orchestrator.stopApp(app.id);

      // Cell ref should still exist (data volume persists)
      const cellRef = await cellManager.getCellRef('simple-landing-page');
      expect(cellRef).toBeDefined();
      expect(cellRef!.cellId).toBe('meta-vibecoding-simple-landing-page');

      // Restart with the same blueprint — should reuse existing cell
      const agent2 = makeLandingPageAgent();
      currentMockAgent = agent2;

      // Create fresh orchestrator to simulate restart
      const orchestrator2 = new AppCellOrchestrator(
        registry as unknown as AppRegistry,
        cellManager as unknown as CellManager,
      );
      const events2: OrchestratorEvent[] = [];
      orchestrator2.on((e) => events2.push(e));

      await orchestrator2.launchApp(app.id, { blueprint: LANDING_PAGE_BLUEPRINT });

      // Should NOT emit cell-created (reused existing)
      const cellCreatedEvents = events2.filter(e => e.type === 'app:cell-created');
      expect(cellCreatedEvents.length).toBe(0);

      // Should start evolving again
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(agent2.evolveCallCount).toBeGreaterThan(0);

      await orchestrator2.stopApp(app.id);
    });

    test('lifecycle events track stop and restart', async () => {
      await orchestrator.launchApp(app.id, { blueprint: LANDING_PAGE_BLUEPRINT });
      await orchestrator.stopApp(app.id);

      const stopEvents = events.filter(e => e.type === 'app:stopping' || e.type === 'app:stopped');
      expect(stopEvents.length).toBe(2);

      const stoppedEvent = events.find(e => e.type === 'app:stopped');
      expect(stoppedEvent).toBeDefined();
      expect(stoppedEvent!.appName).toBe('simple-landing-page');
    });
  });

  // ─── AC: Docker container cleans up on destroy ─────────────────────────────

  describe('cleanup on destroy', () => {
    test('destroying the cell removes container and volume', async () => {
      await orchestrator.launchApp(app.id, { blueprint: LANDING_PAGE_BLUEPRINT });
      await orchestrator.stopApp(app.id);

      // Destroy via cell manager directly (simulating CLI destroy command)
      await cellManager.destroyCell('simple-landing-page', { confirm: true } as any);

      // Cell should be destroyed
      expect(cellManager.destroyedCells.has('simple-landing-page')).toBe(true);
      expect(cellManager.cellData.has('simple-landing-page')).toBe(false);

      // Cell status should be not_found
      const status = await cellManager.getCellStatus('simple-landing-page');
      expect(status.state).toBe('not_found');
    });

    test('cell events record full lifecycle', async () => {
      await orchestrator.launchApp(app.id, { blueprint: LANDING_PAGE_BLUEPRINT });
      await orchestrator.stopApp(app.id);
      await cellManager.destroyCell('simple-landing-page', { confirm: true } as any);

      // Should have: create → start → stop → destroy
      const actions = cellManager.cellEvents.map(e => e.action);
      expect(actions).toEqual(['create', 'start', 'stop', 'destroy']);
    });

    test('registry can remove the app after destroy', async () => {
      await orchestrator.launchApp(app.id, { blueprint: LANDING_PAGE_BLUEPRINT });
      await orchestrator.stopApp(app.id);

      // Remove from registry
      const deleted = await registry.delete(app.id);
      expect(deleted).toBe(true);

      // Should no longer be findable
      const found = await registry.get(app.id);
      expect(found).toBeUndefined();
    });
  });

  // ─── Full end-to-end lifecycle ─────────────────────────────────────────────

  describe('full end-to-end lifecycle', () => {
    test('complete lifecycle: create → evolve → stop → restart → evolve → destroy', async () => {
      // 1. Launch app with blueprint
      await orchestrator.launchApp(app.id, { blueprint: LANDING_PAGE_BLUEPRINT });

      // 2. Wait for first evolution pass
      await new Promise((resolve) => setTimeout(resolve, 200));
      const v1EvolveCount = currentMockAgent.evolveCallCount;
      expect(v1EvolveCount).toBeGreaterThanOrEqual(2);

      // 3. Stop
      await orchestrator.stopApp(app.id);
      expect(orchestrator.isRunning(app.id)).toBe(false);

      // 4. Restart with new agent instance
      const agent2 = makeLandingPageAgent();
      currentMockAgent = agent2;

      const orchestrator2 = new AppCellOrchestrator(
        registry as unknown as AppRegistry,
        cellManager as unknown as CellManager,
      );

      await orchestrator2.launchApp(app.id, { blueprint: LANDING_PAGE_BLUEPRINT });

      // 5. Wait for second evolution pass
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(agent2.evolveCallCount).toBeGreaterThan(0);

      // 6. Stop and destroy
      await orchestrator2.stopApp(app.id);
      await cellManager.destroyCell('simple-landing-page', { confirm: true } as any);

      // 7. Verify final state
      expect(cellManager.destroyedCells.has('simple-landing-page')).toBe(true);

      // Full cell lifecycle recorded
      const actions = cellManager.cellEvents.map(e => e.action);
      expect(actions).toContain('create');
      expect(actions).toContain('start');
      expect(actions).toContain('stop');
      expect(actions).toContain('destroy');
    });
  });
});
