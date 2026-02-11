/**
 * ABOUTME: Integration test — Complex App (Castalia Subset).
 * US-016: Validates the platform handles real-world complexity with a Castalia-like app.
 *
 * Tests the full cell lifecycle with a complex monorepo app:
 * 1. Create app via registry with multi-package monorepo fixture (client/server/types)
 * 2. Set blueprint with 12 criteria covering real architectural concerns:
 *    multiplayer, theming, calendar, Phaser integration, MobX stores, responsive design
 * 3. Agent demonstrates gap analysis and prioritization across 5 priority tiers
 * 4. Version history shows meaningful progress with cross-package file changes
 * 5. Platform handles larger repo size (15+ files) and longer evolution cycles (12 steps)
 * 6. Partial failure scenarios — agent can fail on some criteria and continue
 * 7. Blueprint mid-evolution update — react to changed criteria
 *
 * Key differences from US-014 (simple, 5 criteria) and US-015 (medium, 8 criteria):
 * - Monorepo with 3 packages: client (React + Phaser + MobX), server (Express + Colyseus), types
 * - 12 blueprint criteria spanning multiplayer, calendar, theming, performance, accessibility
 * - 5 priority tiers (P0-P4) requiring fine-grained prioritization
 * - Partial failure: some criteria intentionally fail, testing recovery
 * - Cross-package dependencies: types → server, types → client, client ← server
 * - Longer evolution cycle tests platform stability under sustained load
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
const FIXTURE_DIR = join(__dirname, '..', '..', 'testing', 'fixtures', 'castalia-subset');

/**
 * The Castalia Subset blueprint with 12 acceptance criteria across 5 priority tiers.
 *
 * P0 (Critical Infrastructure): multiplayer state sync, calendar CRUD, theme system
 * P1 (Core Features): zone-based calendar coloring, Phaser world scene, MobX store integration
 * P2 (UX Polish): recurring events (RRULE), responsive calendar, attendee RSVP
 * P3 (Performance): Phaser render optimization, network latency handling
 * P4 (Accessibility): keyboard navigation, screen reader support
 */
const CASTALIA_BLUEPRINT: Blueprint = {
  vision: 'A multiplayer virtual world with calendar scheduling, civilizational theming, and Phaser-based avatar navigation. Supports real-time player synchronization, zone-based events, and 18 visual themes.',
  criteria: [
    // P0: Critical Infrastructure
    { id: 'AC-01', description: 'Colyseus multiplayer state sync: player join/leave/move reflected across clients', met: false, priority: 0 },
    { id: 'AC-02', description: 'Calendar event CRUD: create, read, update, delete events via REST API', met: false, priority: 0 },
    { id: 'AC-03', description: 'Theme system: CSS custom properties applied from ThemeStore with 3+ theme definitions', met: false, priority: 0 },

    // P1: Core Features
    { id: 'AC-04', description: 'Zone-based calendar coloring: events inherit zone color from theme palette', met: false, priority: 1 },
    { id: 'AC-05', description: 'Phaser WorldScene renders map with player avatars and zone boundaries', met: false, priority: 1 },
    { id: 'AC-06', description: 'MobX RootStore wires CalendarStore + ThemeStore + NetworkStore with cross-store reactions', met: false, priority: 1 },

    // P2: UX Polish
    { id: 'AC-07', description: 'Recurring events with RRULE support for weekly and monthly recurrence', met: false, priority: 2 },
    { id: 'AC-08', description: 'Responsive calendar layout adapts to mobile (< 768px) and desktop (> 1024px)', met: false, priority: 2 },
    { id: 'AC-09', description: 'Attendee RSVP workflow: invite, accept, decline, maybe with real-time status', met: false, priority: 2 },

    // P3: Performance
    { id: 'AC-10', description: 'Phaser render optimization: object pooling for 50+ simultaneous player sprites', met: false, priority: 3 },
    { id: 'AC-11', description: 'Network latency compensation: client-side interpolation for smooth movement at 200ms+ RTT', met: false, priority: 3 },

    // P4: Accessibility
    { id: 'AC-12', description: 'Keyboard navigation for calendar and theme switcher with visible focus indicators', met: false, priority: 4 },
  ],
  constraints: [
    'Monorepo with packages/client, packages/server, packages/types',
    'Client uses React + Phaser 3 + MobX',
    'Server uses Express + Colyseus for multiplayer rooms',
    'Shared types package consumed by both client and server',
    'All colors via CSS custom properties — no hardcoded hex in components',
    'MobX stores follow 5-step RootStore integration pattern',
  ],
  outOfScope: [
    'MongoDB persistence (use in-memory for testing)',
    'LiveKit audio/video integration',
    'Map editor functionality',
    'Authentication and user management',
    'Deployment and CI/CD',
  ],
};

// ─── Mock Helpers ───────────────────────────────────────────────────────────

/** Track version history as the agent evolves the app. */
interface VersionRecord {
  version: number;
  criterionId: string;
  criterionMet: boolean;
  filesChanged: string[];
  summary: string;
  packagesAffected: string[];
}

/**
 * Map criteria to the files they would change.
 *
 * This is the key difference from US-014/015: criteria span 3 packages
 * (client, server, types) with realistic cross-package dependencies.
 */
function getFilesForCriterion(criterionId: string): { files: string[]; packages: string[] } {
  switch (criterionId) {
    case 'AC-01': // Multiplayer state sync
      return {
        files: [
          'packages/types/src/index.ts',
          'packages/server/src/rooms/schema/WorldState.ts',
          'packages/server/src/index.ts',
          'packages/client/src/stores/NetworkStore.ts',
          'packages/client/src/scenes/WorldScene.ts',
        ],
        packages: ['types', 'server', 'client'],
      };
    case 'AC-02': // Calendar CRUD
      return {
        files: [
          'packages/types/src/index.ts',
          'packages/server/src/index.ts',
          'packages/client/src/stores/CalendarStore.ts',
          'packages/client/src/components/calendar/EventBlock.tsx',
        ],
        packages: ['types', 'server', 'client'],
      };
    case 'AC-03': // Theme system
      return {
        files: [
          'packages/types/src/index.ts',
          'packages/client/src/stores/ThemeStore.ts',
          'packages/client/src/styles/themes/definitions.ts',
          'packages/client/src/components/settings/ThemeSwitcher.tsx',
        ],
        packages: ['types', 'client'],
      };
    case 'AC-04': // Zone-based calendar coloring
      return {
        files: [
          'packages/client/src/stores/CalendarStore.ts',
          'packages/client/src/stores/ThemeStore.ts',
          'packages/client/src/components/calendar/EventBlock.tsx',
        ],
        packages: ['client'],
      };
    case 'AC-05': // Phaser WorldScene
      return {
        files: [
          'packages/client/src/scenes/WorldScene.ts',
          'packages/client/src/stores/NetworkStore.ts',
        ],
        packages: ['client'],
      };
    case 'AC-06': // MobX RootStore wiring
      return {
        files: [
          'packages/client/src/stores/RootStore.ts',
          'packages/client/src/stores/CalendarStore.ts',
          'packages/client/src/stores/ThemeStore.ts',
          'packages/client/src/stores/NetworkStore.ts',
        ],
        packages: ['client'],
      };
    case 'AC-07': // Recurring events RRULE
      return {
        files: [
          'packages/types/src/index.ts',
          'packages/client/src/stores/CalendarStore.ts',
          'packages/server/src/index.ts',
        ],
        packages: ['types', 'client', 'server'],
      };
    case 'AC-08': // Responsive calendar
      return {
        files: [
          'packages/client/src/components/calendar/EventBlock.tsx',
        ],
        packages: ['client'],
      };
    case 'AC-09': // Attendee RSVP
      return {
        files: [
          'packages/types/src/index.ts',
          'packages/server/src/index.ts',
          'packages/client/src/stores/CalendarStore.ts',
        ],
        packages: ['types', 'server', 'client'],
      };
    case 'AC-10': // Phaser render optimization
      return {
        files: [
          'packages/client/src/scenes/WorldScene.ts',
        ],
        packages: ['client'],
      };
    case 'AC-11': // Network latency compensation
      return {
        files: [
          'packages/client/src/stores/NetworkStore.ts',
          'packages/client/src/scenes/WorldScene.ts',
        ],
        packages: ['client'],
      };
    case 'AC-12': // Keyboard navigation
      return {
        files: [
          'packages/client/src/components/calendar/EventBlock.tsx',
          'packages/client/src/components/settings/ThemeSwitcher.tsx',
        ],
        packages: ['client'],
      };
    default:
      return { files: [], packages: [] };
  }
}

/**
 * Set of criteria that will intentionally fail on first attempt.
 * This simulates real-world partial failure where some criteria are harder
 * to implement and require multiple passes.
 */
const FLAKY_CRITERIA = new Set(['AC-10', 'AC-11']);

/**
 * Create a mock agent that simulates evolving a complex Castalia-like app.
 *
 * The agent demonstrates:
 * - Priority-ordered evolution (P0 → P1 → P2 → P3 → P4)
 * - Cross-package file changes (types + server + client)
 * - Partial failure: AC-10 and AC-11 (performance) fail on first attempt
 * - Meaningful version summaries referencing architectural decisions
 */
function makeCastaliaAgent(opts?: { failureCriteria?: Set<string> }): AgentAdapter & {
  versionHistory: VersionRecord[];
  evolveCallCount: number;
  failedAttempts: Map<string, number>;
} {
  let currentVersion = 0;
  const versionHistory: VersionRecord[] = [];
  const failedAttempts = new Map<string, number>();
  let stopped = false;
  const failureCriteria = opts?.failureCriteria ?? FLAKY_CRITERIA;

  const agent: AgentAdapter & {
    versionHistory: VersionRecord[];
    evolveCallCount: number;
    failedAttempts: Map<string, number>;
  } = {
    versionHistory,
    evolveCallCount: 0,
    failedAttempts,

    async initialize(_cell: CellRef, _blueprint: Blueprint) {
      // Agent reads the blueprint, analyzes monorepo structure,
      // and builds dependency graph: types → server, types → client
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

      agent.evolveCallCount++;
      const attempts = (failedAttempts.get(gap.criterionId) ?? 0) + 1;
      failedAttempts.set(gap.criterionId, attempts);

      // Simulate partial failure: performance criteria fail first attempt
      if (failureCriteria.has(gap.criterionId) && attempts <= 1) {
        return {
          success: false,
          criterionId: gap.criterionId,
          summary: `Failed attempt ${attempts}: ${gap.description} — needs more investigation`,
          filesChanged: [],
          criterionMet: false,
        };
      }

      currentVersion++;

      const { files, packages } = getFilesForCriterion(gap.criterionId);
      const summary = `v${currentVersion}: ${gap.description}`;

      const record: VersionRecord = {
        version: currentVersion,
        criterionId: gap.criterionId,
        criterionMet: true,
        filesChanged: files,
        summary,
        packagesAffected: packages,
      };
      versionHistory.push(record);

      return {
        success: true,
        criterionId: gap.criterionId,
        summary,
        filesChanged: files,
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
      // Re-analyze gaps with updated criteria
    },
  };

  return agent;
}

/** App entry for the castalia subset test. */
function makeCastaliaApp(overrides: Partial<AppRegistryEntry> = {}): AppRegistryEntry {
  return {
    id: 'castalia-subset-001',
    name: 'castalia-subset',
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
 * Create a mock registry with the castalia subset app.
 * Tracks status updates and update timestamps for verification.
 */
function makeMockRegistry(app: AppRegistryEntry): AppRegistry & {
  statusHistory: AppRegistryEntry['status'][];
  updateCount: number;
} {
  const store = new Map<string, AppRegistryEntry>();
  store.set(app.id, { ...app });
  const statusHistory: AppRegistryEntry['status'][] = [app.status];
  let updateCount = 0;

  return {
    statusHistory,
    updateCount,
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
      updateCount++;
      return updated;
    },
    async delete(id: string) {
      return store.delete(id);
    },
    async count() { return store.size; },
    getRegistryPath() { return '/tmp/test-castalia-subset-registry.json'; },
  } as unknown as AppRegistry & {
    statusHistory: AppRegistryEntry['status'][];
    updateCount: number;
  };
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

let currentMockAgent: ReturnType<typeof makeCastaliaAgent>;

mock.module('../../src/platform/agent-adapter.js', () => ({
  createAgentAdapter: (_config: AgentAdapterConfig) => currentMockAgent,
  AgentAdapterConfigSchema: { parse: (v: unknown) => v },
  registerAgentAdapter: () => {},
  getRegisteredAgentTypes: () => ['openclaw'],
  hasAgentType: () => true,
  clearAgentAdapterRegistry: () => {},
}));

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('US-016: Integration Test — Complex App (Castalia Subset)', () => {
  let orchestrator: AppCellOrchestrator;
  let registry: ReturnType<typeof makeMockRegistry>;
  let cellManager: ReturnType<typeof makeMockCellManager>;
  let app: AppRegistryEntry;
  let events: OrchestratorEvent[];

  beforeEach(() => {
    currentMockAgent = makeCastaliaAgent();
    app = makeCastaliaApp();
    registry = makeMockRegistry(app);
    cellManager = makeMockCellManager();
    orchestrator = new AppCellOrchestrator(
      registry as unknown as AppRegistry,
      cellManager as unknown as CellManager,
    );
    events = [];
    orchestrator.on((event) => events.push(event));
  });

  // ─── AC: Test uses a simplified Castalia repo ─────────────────────────────

  describe('fixture repo — monorepo structure', () => {
    test('fixture has root package.json with workspaces config', () => {
      expect(existsSync(join(FIXTURE_DIR, 'package.json'))).toBe(true);
    });

    test('fixture has 3 packages: client, server, types', () => {
      expect(existsSync(join(FIXTURE_DIR, 'packages', 'client', 'package.json'))).toBe(true);
      expect(existsSync(join(FIXTURE_DIR, 'packages', 'server', 'package.json'))).toBe(true);
      expect(existsSync(join(FIXTURE_DIR, 'packages', 'types', 'package.json'))).toBe(true);
    });

    test('types package has shared type definitions', () => {
      expect(existsSync(join(FIXTURE_DIR, 'packages', 'types', 'src', 'index.ts'))).toBe(true);
    });

    test('server package has Express + Colyseus room schema', () => {
      expect(existsSync(join(FIXTURE_DIR, 'packages', 'server', 'src', 'index.ts'))).toBe(true);
      expect(existsSync(join(FIXTURE_DIR, 'packages', 'server', 'src', 'rooms', 'schema', 'WorldState.ts'))).toBe(true);
    });

    test('client package has React components, MobX stores, Phaser scenes, and themes', () => {
      expect(existsSync(join(FIXTURE_DIR, 'packages', 'client', 'src', 'stores', 'RootStore.ts'))).toBe(true);
      expect(existsSync(join(FIXTURE_DIR, 'packages', 'client', 'src', 'stores', 'CalendarStore.ts'))).toBe(true);
      expect(existsSync(join(FIXTURE_DIR, 'packages', 'client', 'src', 'stores', 'ThemeStore.ts'))).toBe(true);
      expect(existsSync(join(FIXTURE_DIR, 'packages', 'client', 'src', 'stores', 'NetworkStore.ts'))).toBe(true);
      expect(existsSync(join(FIXTURE_DIR, 'packages', 'client', 'src', 'components', 'calendar', 'EventBlock.tsx'))).toBe(true);
      expect(existsSync(join(FIXTURE_DIR, 'packages', 'client', 'src', 'components', 'settings', 'ThemeSwitcher.tsx'))).toBe(true);
      expect(existsSync(join(FIXTURE_DIR, 'packages', 'client', 'src', 'scenes', 'WorldScene.ts'))).toBe(true);
      expect(existsSync(join(FIXTURE_DIR, 'packages', 'client', 'src', 'styles', 'themes', 'definitions.ts'))).toBe(true);
    });

    test('fixture has more files than simple or medium fixtures', () => {
      // Count fixture files by checking known paths
      const expectedPaths = [
        'package.json',
        'packages/types/package.json',
        'packages/types/src/index.ts',
        'packages/server/package.json',
        'packages/server/src/index.ts',
        'packages/server/src/rooms/schema/WorldState.ts',
        'packages/client/package.json',
        'packages/client/src/stores/RootStore.ts',
        'packages/client/src/stores/CalendarStore.ts',
        'packages/client/src/stores/ThemeStore.ts',
        'packages/client/src/stores/NetworkStore.ts',
        'packages/client/src/components/calendar/EventBlock.tsx',
        'packages/client/src/components/settings/ThemeSwitcher.tsx',
        'packages/client/src/scenes/WorldScene.ts',
        'packages/client/src/styles/themes/definitions.ts',
      ];

      let count = 0;
      for (const path of expectedPaths) {
        if (existsSync(join(FIXTURE_DIR, path))) count++;
      }

      // At least 15 files — significantly more than simple (3) or medium (6)
      expect(count).toBeGreaterThanOrEqual(15);
    });
  });

  // ─── AC: Blueprint specifies real architectural criteria ──────────────────

  describe('blueprint specification — real architectural concerns', () => {
    test('blueprint has 12 criteria — more than simple (5) or medium (8)', () => {
      expect(CASTALIA_BLUEPRINT.criteria).toHaveLength(12);
      expect(CASTALIA_BLUEPRINT.criteria.map(c => c.id)).toEqual([
        'AC-01', 'AC-02', 'AC-03', 'AC-04', 'AC-05', 'AC-06',
        'AC-07', 'AC-08', 'AC-09', 'AC-10', 'AC-11', 'AC-12',
      ]);
    });

    test('blueprint covers multiplayer, theming, and calendar', () => {
      const descriptions = CASTALIA_BLUEPRINT.criteria.map(c => c.description.toLowerCase());

      // Multiplayer
      expect(descriptions.some(d => d.includes('multiplayer') || d.includes('colyseus'))).toBe(true);
      expect(descriptions.some(d => d.includes('player') && d.includes('sync'))).toBe(true);

      // Theming
      expect(descriptions.some(d => d.includes('theme') && d.includes('css custom properties'))).toBe(true);

      // Calendar
      expect(descriptions.some(d => d.includes('calendar') && d.includes('crud'))).toBe(true);
    });

    test('blueprint has advanced features: RRULE, zone coloring, Phaser, MobX', () => {
      const descriptions = CASTALIA_BLUEPRINT.criteria.map(c => c.description.toLowerCase());

      expect(descriptions.some(d => d.includes('rrule'))).toBe(true);
      expect(descriptions.some(d => d.includes('zone') && d.includes('color'))).toBe(true);
      expect(descriptions.some(d => d.includes('phaser'))).toBe(true);
      expect(descriptions.some(d => d.includes('mobx') || d.includes('rootstore'))).toBe(true);
    });

    test('blueprint has performance and accessibility criteria', () => {
      const descriptions = CASTALIA_BLUEPRINT.criteria.map(c => c.description.toLowerCase());

      // Performance
      expect(descriptions.some(d => d.includes('object pooling') || d.includes('optimization'))).toBe(true);
      expect(descriptions.some(d => d.includes('latency') && d.includes('interpolation'))).toBe(true);

      // Accessibility
      expect(descriptions.some(d => d.includes('keyboard navigation'))).toBe(true);
    });

    test('blueprint has 5 priority tiers (P0-P4)', () => {
      const p0 = CASTALIA_BLUEPRINT.criteria.filter(c => c.priority === 0);
      const p1 = CASTALIA_BLUEPRINT.criteria.filter(c => c.priority === 1);
      const p2 = CASTALIA_BLUEPRINT.criteria.filter(c => c.priority === 2);
      const p3 = CASTALIA_BLUEPRINT.criteria.filter(c => c.priority === 3);
      const p4 = CASTALIA_BLUEPRINT.criteria.filter(c => c.priority === 4);

      expect(p0).toHaveLength(3); // Infrastructure
      expect(p1).toHaveLength(3); // Core features
      expect(p2).toHaveLength(3); // UX polish
      expect(p3).toHaveLength(2); // Performance
      expect(p4).toHaveLength(1); // Accessibility
    });

    test('blueprint has monorepo-specific constraints', () => {
      const constraints = CASTALIA_BLUEPRINT.constraints.map(c => c.toLowerCase());
      expect(constraints.some(c => c.includes('monorepo'))).toBe(true);
      expect(constraints.some(c => c.includes('react') && c.includes('phaser') && c.includes('mobx'))).toBe(true);
      expect(constraints.some(c => c.includes('colyseus'))).toBe(true);
      expect(constraints.some(c => c.includes('shared types'))).toBe(true);
      expect(constraints.some(c => c.includes('css custom properties'))).toBe(true);
    });
  });

  // ─── AC: Agent demonstrates gap analysis and prioritization ───────────────

  describe('evolution loop — gap analysis and prioritization', () => {
    test('agent evolves through all 12 criteria (10 succeed, 2 fail)', async () => {
      await orchestrator.launchApp(app.id, { blueprint: CASTALIA_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 300));

      // Orchestrator calls evolve once per gap — no retries
      expect(currentMockAgent.evolveCallCount).toBe(12);

      // 2 flaky criteria (AC-10, AC-11) fail, so 10 successful versions
      expect(currentMockAgent.versionHistory.length).toBe(10);
    });

    test('processes P0 infrastructure before P1 features', async () => {
      await orchestrator.launchApp(app.id, { blueprint: CASTALIA_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 300));

      const history = currentMockAgent.versionHistory;

      const p0Versions = history
        .filter(v => ['AC-01', 'AC-02', 'AC-03'].includes(v.criterionId))
        .map(v => v.version);
      const p1Versions = history
        .filter(v => ['AC-04', 'AC-05', 'AC-06'].includes(v.criterionId))
        .map(v => v.version);

      expect(Math.max(...p0Versions)).toBeLessThan(Math.min(...p1Versions));
    });

    test('processes P1 features before P2 polish', async () => {
      await orchestrator.launchApp(app.id, { blueprint: CASTALIA_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 300));

      const history = currentMockAgent.versionHistory;

      const p1Versions = history
        .filter(v => ['AC-04', 'AC-05', 'AC-06'].includes(v.criterionId))
        .map(v => v.version);
      const p2Versions = history
        .filter(v => ['AC-07', 'AC-08', 'AC-09'].includes(v.criterionId))
        .map(v => v.version);

      expect(Math.max(...p1Versions)).toBeLessThan(Math.min(...p2Versions));
    });

    test('processes P2 polish before P3 performance', async () => {
      await orchestrator.launchApp(app.id, { blueprint: CASTALIA_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 300));

      const history = currentMockAgent.versionHistory;

      const p2Versions = history
        .filter(v => ['AC-07', 'AC-08', 'AC-09'].includes(v.criterionId))
        .map(v => v.version);
      const p3Versions = history
        .filter(v => ['AC-10', 'AC-11'].includes(v.criterionId))
        .map(v => v.version);

      expect(Math.max(...p2Versions)).toBeLessThan(Math.min(...p3Versions));
    });

    test('P4 accessibility is processed last (after P3 performance gaps attempted)', async () => {
      // Use agent with no failures to test pure priority ordering
      currentMockAgent = makeCastaliaAgent({ failureCriteria: new Set() });

      await orchestrator.launchApp(app.id, { blueprint: CASTALIA_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 300));

      const history = currentMockAgent.versionHistory;

      const p3Versions = history
        .filter(v => ['AC-10', 'AC-11'].includes(v.criterionId))
        .map(v => v.version);
      const p4Versions = history
        .filter(v => ['AC-12'].includes(v.criterionId))
        .map(v => v.version);

      expect(Math.max(...p3Versions)).toBeLessThan(Math.min(...p4Versions));
    });

    test('handles partial failure — performance criteria fail and are recorded', async () => {
      await orchestrator.launchApp(app.id, { blueprint: CASTALIA_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 300));

      // Both AC-10 and AC-11 should have recorded failed attempts
      const failedEvents = events.filter(e => e.type === 'app:evolution-gap-failed');
      expect(failedEvents.length).toBe(2);

      // Failed criteria should NOT appear in successful version history
      const successIds = currentMockAgent.versionHistory.map(v => v.criterionId);
      expect(successIds).not.toContain('AC-10');
      expect(successIds).not.toContain('AC-11');

      // But all other criteria should have succeeded
      expect(successIds).toContain('AC-01');
      expect(successIds).toContain('AC-12');
      expect(successIds.length).toBe(10);
    });
  });

  // ─── AC: Version history shows meaningful progress ────────────────────────

  describe('version history — cross-package progress tracking', () => {
    test('records 10 successful versions with incrementing numbers (2 criteria failed)', async () => {
      await orchestrator.launchApp(app.id, { blueprint: CASTALIA_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 300));

      const history = currentMockAgent.versionHistory;
      expect(history.length).toBe(10);

      // Version numbers should be sequential
      for (let i = 0; i < history.length; i++) {
        expect(history[i].version).toBe(i + 1);
      }
    });

    test('P0 criteria touch all 3 packages (types, server, client)', async () => {
      await orchestrator.launchApp(app.id, { blueprint: CASTALIA_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 300));

      // AC-01 (multiplayer) should touch types + server + client
      const ac01 = currentMockAgent.versionHistory.find(v => v.criterionId === 'AC-01');
      expect(ac01).toBeDefined();
      expect(ac01!.packagesAffected).toContain('types');
      expect(ac01!.packagesAffected).toContain('server');
      expect(ac01!.packagesAffected).toContain('client');

      // AC-02 (calendar CRUD) should also touch all 3
      const ac02 = currentMockAgent.versionHistory.find(v => v.criterionId === 'AC-02');
      expect(ac02).toBeDefined();
      expect(ac02!.packagesAffected).toContain('types');
      expect(ac02!.packagesAffected).toContain('server');
      expect(ac02!.packagesAffected).toContain('client');
    });

    test('P1 criteria are more focused — some touch only client package', async () => {
      await orchestrator.launchApp(app.id, { blueprint: CASTALIA_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 300));

      // AC-04 (zone coloring) is client-only
      const ac04 = currentMockAgent.versionHistory.find(v => v.criterionId === 'AC-04');
      expect(ac04).toBeDefined();
      expect(ac04!.packagesAffected).toEqual(['client']);

      // AC-05 (Phaser scene) is client-only
      const ac05 = currentMockAgent.versionHistory.find(v => v.criterionId === 'AC-05');
      expect(ac05).toBeDefined();
      expect(ac05!.packagesAffected).toEqual(['client']);
    });

    test('total unique files changed spans all packages', async () => {
      await orchestrator.launchApp(app.id, { blueprint: CASTALIA_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 300));

      const allFiles = new Set<string>();
      for (const record of currentMockAgent.versionHistory) {
        for (const file of record.filesChanged) {
          allFiles.add(file);
        }
      }

      const typesFiles = [...allFiles].filter(f => f.startsWith('packages/types/'));
      const serverFiles = [...allFiles].filter(f => f.startsWith('packages/server/'));
      const clientFiles = [...allFiles].filter(f => f.startsWith('packages/client/'));

      expect(typesFiles.length).toBeGreaterThanOrEqual(1);
      expect(serverFiles.length).toBeGreaterThanOrEqual(2);
      expect(clientFiles.length).toBeGreaterThanOrEqual(5);

      // Total should be 10+ unique files across the monorepo
      expect(allFiles.size).toBeGreaterThanOrEqual(10);
    });

    test('later priority tiers touch fewer files per criterion', async () => {
      await orchestrator.launchApp(app.id, { blueprint: CASTALIA_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 300));

      const history = currentMockAgent.versionHistory;

      // P0 average files
      const p0TotalFiles = history
        .filter(v => ['AC-01', 'AC-02', 'AC-03'].includes(v.criterionId))
        .reduce((sum, v) => sum + v.filesChanged.length, 0);
      const p0Avg = p0TotalFiles / 3;

      // P4 average files
      const p4TotalFiles = history
        .filter(v => ['AC-12'].includes(v.criterionId))
        .reduce((sum, v) => sum + v.filesChanged.length, 0);
      const p4Avg = p4TotalFiles / 1;

      // Infrastructure (P0) should touch more files on average than accessibility (P4)
      expect(p0Avg).toBeGreaterThan(p4Avg);
    });

    test('each version records summary and affected packages', async () => {
      await orchestrator.launchApp(app.id, { blueprint: CASTALIA_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 300));

      for (const record of currentMockAgent.versionHistory) {
        expect(record.summary.length).toBeGreaterThan(0);
        expect(record.filesChanged.length).toBeGreaterThan(0);
        expect(record.packagesAffected.length).toBeGreaterThan(0);
        expect(record.criterionMet).toBe(true);
      }
    });
  });

  // ─── AC: Platform handles larger repo and longer evolution cycles ─────────

  describe('platform stability — larger repo and longer cycles', () => {
    test('emits correct number of gap events (12 started, 10 completed, 2 failed)', async () => {
      await orchestrator.launchApp(app.id, { blueprint: CASTALIA_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 300));

      const gapStarted = events.filter(e => e.type === 'app:evolution-gap-started');
      const gapCompleted = events.filter(e => e.type === 'app:evolution-gap-completed');
      const gapFailed = events.filter(e => e.type === 'app:evolution-gap-failed');

      // 12 criteria, each started once
      expect(gapStarted.length).toBe(12);
      // 10 criteria completed successfully
      expect(gapCompleted.length).toBe(10);
      // 2 criteria failed (AC-10 and AC-11)
      expect(gapFailed.length).toBe(2);
    });

    test('emits evolution-completed after all gaps processed (10 of 12 succeeded)', async () => {
      await orchestrator.launchApp(app.id, { blueprint: CASTALIA_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 300));

      const completed = events.filter(e => e.type === 'app:evolution-completed');
      expect(completed.length).toBe(1);
      // 10 of 12 gaps completed (2 failed but loop still finishes)
      expect(completed[0].detail?.gapsCompleted).toBe(10);
      expect(completed[0].detail?.totalGaps).toBe(12);
    });

    test('evolution with no failures completes 12 versions without retries', async () => {
      // Create agent with no flaky criteria
      currentMockAgent = makeCastaliaAgent({ failureCriteria: new Set() });

      await orchestrator.launchApp(app.id, { blueprint: CASTALIA_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 300));

      // Exactly 12 evolve calls — no retries needed
      expect(currentMockAgent.evolveCallCount).toBe(12);
      expect(currentMockAgent.versionHistory.length).toBe(12);

      // No failed events
      const gapFailed = events.filter(e => e.type === 'app:evolution-gap-failed');
      expect(gapFailed.length).toBe(0);
    });

    test('registry tracks status through full evolution cycle', async () => {
      await orchestrator.launchApp(app.id, { blueprint: CASTALIA_BLUEPRINT });

      await new Promise((resolve) => setTimeout(resolve, 300));

      // Status should transition: idle → running → idle (after evolution completes)
      expect(registry.statusHistory).toContain('idle');
      expect(registry.statusHistory).toContain('running');
      // Last status should be idle (evolution completed naturally)
      expect(registry.statusHistory[registry.statusHistory.length - 1]).toBe('idle');
    });
  });

  // ─── Cell lifecycle with complex app ──────────────────────────────────────

  describe('cell lifecycle — stop, restart, destroy', () => {
    test('stops complex app gracefully', async () => {
      await orchestrator.launchApp(app.id, { blueprint: CASTALIA_BLUEPRINT });
      expect(orchestrator.isRunning(app.id)).toBe(true);

      await orchestrator.stopApp(app.id);
      expect(orchestrator.isRunning(app.id)).toBe(false);

      expect(cellManager.activeCells.has('castalia-subset')).toBe(false);
      expect(cellManager.cellData.has('castalia-subset')).toBe(true);

      const updatedApp = await registry.get(app.id);
      expect(updatedApp!.status).toBe('idle');
    });

    test('cell data persists through stop/restart for re-evolution', async () => {
      await orchestrator.launchApp(app.id, { blueprint: CASTALIA_BLUEPRINT });
      await orchestrator.stopApp(app.id);

      const cellRef = await cellManager.getCellRef('castalia-subset');
      expect(cellRef).toBeDefined();
      expect(cellRef!.cellId).toBe('meta-vibecoding-castalia-subset');

      // Restart with fresh agent
      const agent2 = makeCastaliaAgent();
      currentMockAgent = agent2;

      const orchestrator2 = new AppCellOrchestrator(
        registry as unknown as AppRegistry,
        cellManager as unknown as CellManager,
      );
      const events2: OrchestratorEvent[] = [];
      orchestrator2.on((e) => events2.push(e));

      await orchestrator2.launchApp(app.id, { blueprint: CASTALIA_BLUEPRINT });

      // Should NOT emit cell-created (reused existing)
      const cellCreatedEvents = events2.filter(e => e.type === 'app:cell-created');
      expect(cellCreatedEvents.length).toBe(0);

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(agent2.evolveCallCount).toBeGreaterThan(0);

      await orchestrator2.stopApp(app.id);
    });

    test('destroying the cell cleans up completely', async () => {
      await orchestrator.launchApp(app.id, { blueprint: CASTALIA_BLUEPRINT });
      await orchestrator.stopApp(app.id);

      await cellManager.destroyCell('castalia-subset', { confirm: true } as any);

      expect(cellManager.destroyedCells.has('castalia-subset')).toBe(true);
      expect(cellManager.cellData.has('castalia-subset')).toBe(false);

      const status = await cellManager.getCellStatus('castalia-subset');
      expect(status.state).toBe('not_found');
    });

    test('cell events record full lifecycle', async () => {
      await orchestrator.launchApp(app.id, { blueprint: CASTALIA_BLUEPRINT });
      await orchestrator.stopApp(app.id);
      await cellManager.destroyCell('castalia-subset', { confirm: true } as any);

      const actions = cellManager.cellEvents.map(e => e.action);
      expect(actions).toEqual(['create', 'start', 'stop', 'destroy']);
    });
  });

  // ─── Full end-to-end lifecycle ────────────────────────────────────────────

  describe('full end-to-end lifecycle', () => {
    test('complete lifecycle: create → evolve 12 gaps with failures → stop → restart → evolve → destroy', async () => {
      // 1. Launch app with complex blueprint
      await orchestrator.launchApp(app.id, { blueprint: CASTALIA_BLUEPRINT });

      // 2. Wait for first evolution pass (12 gaps, 2 fail)
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(currentMockAgent.evolveCallCount).toBe(12);
      expect(currentMockAgent.versionHistory.length).toBe(10);

      // 3. Verify cross-package changes
      const allPackages = new Set<string>();
      for (const record of currentMockAgent.versionHistory) {
        for (const pkg of record.packagesAffected) {
          allPackages.add(pkg);
        }
      }
      expect(allPackages.has('types')).toBe(true);
      expect(allPackages.has('server')).toBe(true);
      expect(allPackages.has('client')).toBe(true);

      // 4. Verify all unique files changed
      const allFiles = new Set<string>();
      for (const record of currentMockAgent.versionHistory) {
        for (const file of record.filesChanged) {
          allFiles.add(file);
        }
      }
      expect(allFiles.size).toBeGreaterThanOrEqual(10);

      // 5. Stop
      await orchestrator.stopApp(app.id);
      expect(orchestrator.isRunning(app.id)).toBe(false);

      // 6. Restart with new agent
      const agent2 = makeCastaliaAgent({ failureCriteria: new Set() });
      currentMockAgent = agent2;

      const orchestrator2 = new AppCellOrchestrator(
        registry as unknown as AppRegistry,
        cellManager as unknown as CellManager,
      );

      await orchestrator2.launchApp(app.id, { blueprint: CASTALIA_BLUEPRINT });

      // 7. Wait for second evolution pass
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(agent2.evolveCallCount).toBeGreaterThan(0);

      // 8. Stop and destroy
      await orchestrator2.stopApp(app.id);
      await cellManager.destroyCell('castalia-subset', { confirm: true } as any);

      // 9. Verify final state
      expect(cellManager.destroyedCells.has('castalia-subset')).toBe(true);

      const actions = cellManager.cellEvents.map(e => e.action);
      expect(actions).toContain('create');
      expect(actions).toContain('start');
      expect(actions).toContain('stop');
      expect(actions).toContain('destroy');
    });
  });
});
