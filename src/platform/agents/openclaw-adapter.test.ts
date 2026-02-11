/**
 * ABOUTME: Unit tests for the OpenClaw Agent Adapter.
 * Tests gap analysis, task delegation, blueprint updates, stop behavior,
 * and factory registration.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import type {
  AgentAdapterConfig,
  Blueprint,
  BlueprintCriterion,
  CellRef,
  EvolutionGap,
} from '../agent-adapter.js';
import {
  createAgentAdapter,
  clearAgentAdapterRegistry,
} from '../agent-adapter.js';
import type { AgentPlugin, AgentExecutionHandle, AgentExecutionResult } from '../../plugins/agents/types.js';
import {
  OpenClawAdapter,
  analyzeGaps,
  buildTaskPrompt,
  registerOpenClawAdapter,
  createOpenClawAdapter,
} from './openclaw-adapter.js';
import type { OpenClawTask } from './openclaw-adapter.js';

// ─── Test Fixtures ──────────────────────────────────────────────────────────

function makeCell(overrides?: Partial<CellRef>): CellRef {
  return {
    cellId: 'cell-test-001',
    workDir: '/workspace/test-app',
    stackType: 'node',
    ...overrides,
  };
}

function makeCriterion(overrides?: Partial<BlueprintCriterion>): BlueprintCriterion {
  return {
    id: 'crit-001',
    description: 'App has a landing page',
    met: false,
    priority: 1,
    ...overrides,
  };
}

function makeBlueprint(overrides?: Partial<Blueprint>): Blueprint {
  return {
    vision: 'A simple web app with landing page and contact form',
    criteria: [
      makeCriterion({ id: 'crit-001', description: 'App has a landing page', priority: 1 }),
      makeCriterion({ id: 'crit-002', description: 'App has a contact form', priority: 2 }),
      makeCriterion({ id: 'crit-003', description: 'Design uses responsive CSS', priority: 3, met: true }),
    ],
    constraints: ['Must use vanilla HTML/CSS', 'No server-side rendering'],
    outOfScope: ['Backend API', 'Authentication'],
    ...overrides,
  };
}

function makeGap(overrides?: Partial<EvolutionGap>): EvolutionGap {
  return {
    criterionId: 'crit-001',
    description: 'Landing page does not exist yet',
    priority: 1,
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<AgentAdapterConfig>): AgentAdapterConfig {
  return {
    agentType: 'openclaw',
    config: {},
    toolPreferences: {
      primary: 'ralph',
      fallbacks: ['claude-code'],
    },
    ...overrides,
  };
}

/**
 * Create a mock AgentPlugin that returns a configurable result.
 */
function makeMockTool(options?: {
  exitCode?: number;
  stdout?: string;
  status?: AgentExecutionResult['status'];
  error?: string;
  shouldThrow?: boolean;
}): AgentPlugin {
  const {
    exitCode = 0,
    stdout = '<promise>COMPLETE</promise>',
    status = 'completed',
    error,
    shouldThrow = false,
  } = options ?? {};

  let interruptCalled = false;

  const mockResult: AgentExecutionResult = {
    executionId: 'exec-mock-001',
    status,
    exitCode,
    stdout,
    stderr: '',
    durationMs: 1000,
    interrupted: false,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    error,
  };

  const mockHandle: AgentExecutionHandle = {
    executionId: 'exec-mock-001',
    promise: shouldThrow
      ? Promise.reject(new Error('Tool execution failed'))
      : Promise.resolve(mockResult),
    interrupt() {
      interruptCalled = true;
    },
    isRunning() {
      return !interruptCalled;
    },
  };

  return {
    meta: {
      id: 'mock-tool',
      name: 'Mock Tool',
      description: 'A mock coding tool for tests',
      version: '1.0.0',
      defaultCommand: 'mock',
      supportsStreaming: false,
      supportsInterrupt: true,
      supportsFileContext: false,
      supportsSubagentTracing: false,
    },
    async initialize() {},
    async isReady() { return true; },
    async detect() { return { available: true, version: '1.0.0' }; },
    getSandboxRequirements() {
      return { authPaths: [], binaryPaths: [], runtimePaths: [], requiresNetwork: false };
    },
    execute(_prompt, _files, opts) {
      // Call onStdout if provided to simulate tool output
      if (opts?.onStdout) {
        opts.onStdout(stdout);
      }
      return mockHandle;
    },
    interrupt() { return true; },
    interruptAll() {},
    getCurrentExecution() { return undefined; },
    getSetupQuestions() { return []; },
    async validateSetup() { return null; },
    validateModel() { return null; },
    async preflight() { return { success: true }; },
    async dispose() {},
  };
}

// ─── Tests: analyzeGaps ─────────────────────────────────────────────────────

describe('analyzeGaps', () => {
  test('returns tasks for unmet criteria only', () => {
    const bp = makeBlueprint();
    const tasks = analyzeGaps(bp);

    // crit-003 is met, so only 2 tasks
    expect(tasks).toHaveLength(2);
    expect(tasks.map((t) => t.criterionId)).toEqual(['crit-001', 'crit-002']);
  });

  test('returns empty array when all criteria met', () => {
    const bp = makeBlueprint({
      criteria: [
        makeCriterion({ id: 'c1', met: true }),
        makeCriterion({ id: 'c2', met: true }),
      ],
    });
    expect(analyzeGaps(bp)).toHaveLength(0);
  });

  test('sorts by priority (lower = higher priority)', () => {
    const bp = makeBlueprint({
      criteria: [
        makeCriterion({ id: 'low', priority: 10 }),
        makeCriterion({ id: 'high', priority: 1 }),
        makeCriterion({ id: 'mid', priority: 5 }),
      ],
    });
    const tasks = analyzeGaps(bp);
    expect(tasks[0].criterionId).toBe('high');
    expect(tasks[1].criterionId).toBe('mid');
    expect(tasks[2].criterionId).toBe('low');
  });

  test('respects maxTasks limit', () => {
    const bp = makeBlueprint({
      criteria: [
        makeCriterion({ id: 'c1', priority: 1 }),
        makeCriterion({ id: 'c2', priority: 2 }),
        makeCriterion({ id: 'c3', priority: 3 }),
      ],
    });
    const tasks = analyzeGaps(bp, 2);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].criterionId).toBe('c1');
    expect(tasks[1].criterionId).toBe('c2');
  });

  test('infers complexity from description keywords', () => {
    const bp = makeBlueprint({
      criteria: [
        makeCriterion({ id: 'arch', description: 'Design the database schema', priority: 1 }),
        makeCriterion({ id: 'mech', description: 'Fix type errors in utils', priority: 2 }),
        makeCriterion({ id: 'feat', description: 'Implement user registration', priority: 3 }),
        makeCriterion({ id: 'simple', description: 'Update color palette', priority: 4 }),
      ],
    });
    const tasks = analyzeGaps(bp);
    expect(tasks.find((t) => t.criterionId === 'arch')!.complexity).toBe('architecture');
    expect(tasks.find((t) => t.criterionId === 'mech')!.complexity).toBe('mechanical');
    expect(tasks.find((t) => t.criterionId === 'feat')!.complexity).toBe('feature');
    expect(tasks.find((t) => t.criterionId === 'simple')!.complexity).toBe('simple');
  });

  test('assigns sequential task IDs', () => {
    const bp = makeBlueprint({
      criteria: [
        makeCriterion({ id: 'c1', priority: 1 }),
        makeCriterion({ id: 'c2', priority: 2 }),
      ],
    });
    const tasks = analyzeGaps(bp);
    expect(tasks[0].id).toBe('OC-1');
    expect(tasks[1].id).toBe('OC-2');
  });
});

// ─── Tests: buildTaskPrompt ─────────────────────────────────────────────────

describe('buildTaskPrompt', () => {
  test('includes task title and description', () => {
    const task: OpenClawTask = {
      id: 'OC-1',
      title: 'Build landing page',
      description: 'Create an HTML landing page with hero section',
      complexity: 'feature',
      criterionId: 'crit-001',
      priority: 1,
      completed: false,
    };
    const prompt = buildTaskPrompt(task, makeBlueprint(), makeCell());

    expect(prompt).toContain('Build landing page');
    expect(prompt).toContain('Create an HTML landing page with hero section');
    expect(prompt).toContain('crit-001');
  });

  test('includes cell context', () => {
    const prompt = buildTaskPrompt(
      { id: 'OC-1', title: 'Test', description: 'Test', complexity: 'simple', criterionId: 'c1', priority: 1, completed: false },
      makeBlueprint(),
      makeCell({ stackType: 'python', workDir: '/app/my-project' }),
    );
    expect(prompt).toContain('python');
    expect(prompt).toContain('/app/my-project');
  });

  test('includes blueprint constraints', () => {
    const bp = makeBlueprint({ constraints: ['No frameworks', 'Must be accessible'] });
    const prompt = buildTaskPrompt(
      { id: 'OC-1', title: 'T', description: 'D', complexity: 'simple', criterionId: 'c1', priority: 1, completed: false },
      bp,
      makeCell(),
    );
    expect(prompt).toContain('No frameworks');
    expect(prompt).toContain('Must be accessible');
  });
});

// ─── Tests: OpenClawAdapter ─────────────────────────────────────────────────

describe('OpenClawAdapter', () => {
  let adapter: OpenClawAdapter;
  let mockTool: AgentPlugin;

  beforeEach(() => {
    mockTool = makeMockTool();
    adapter = new OpenClawAdapter(makeConfig(), { codingTool: mockTool });
  });

  describe('initialize', () => {
    test('populates task queue from blueprint gap analysis', async () => {
      await adapter.initialize(makeCell(), makeBlueprint());

      const queue = adapter.getTaskQueue();
      expect(queue.length).toBe(2); // 2 unmet criteria
      expect(queue[0].criterionId).toBe('crit-001');
      expect(queue[1].criterionId).toBe('crit-002');
    });

    test('logs initial gap analysis decision', async () => {
      await adapter.initialize(makeCell(), makeBlueprint());

      const log = adapter.getDecisionsLog();
      expect(log).toHaveLength(1);
      expect(log[0].type).toBe('gap_analysis');
      expect(log[0].description).toContain('2 tasks');
    });

    test('status is idle after initialization', async () => {
      await adapter.initialize(makeCell(), makeBlueprint());
      expect(adapter.status().state).toBe('idle');
    });

    test('stores blueprint for later access', async () => {
      const bp = makeBlueprint();
      await adapter.initialize(makeCell(), bp);
      expect(adapter.getBlueprint()).toBe(bp);
    });
  });

  describe('evolve', () => {
    beforeEach(async () => {
      await adapter.initialize(makeCell(), makeBlueprint());
    });

    test('delegates to coding tool and returns success', async () => {
      const result = await adapter.evolve(makeGap());

      expect(result.success).toBe(true);
      expect(result.criterionId).toBe('crit-001');
      expect(result.criterionMet).toBe(true);
    });

    test('marks task as completed on success', async () => {
      await adapter.evolve(makeGap());

      const queue = adapter.getTaskQueue();
      const task = queue.find((t) => t.criterionId === 'crit-001');
      expect(task!.completed).toBe(true);
    });

    test('logs delegation and completion decisions', async () => {
      await adapter.evolve(makeGap());

      const log = adapter.getDecisionsLog();
      // gap_analysis + task_delegated + task_completed = 3
      expect(log).toHaveLength(3);
      expect(log[1].type).toBe('task_delegated');
      expect(log[2].type).toBe('task_completed');
    });

    test('creates ad-hoc task for unknown gap criterion', async () => {
      const gap = makeGap({ criterionId: 'crit-unknown', description: 'Fix something' });
      const result = await adapter.evolve(gap);

      expect(result.success).toBe(true);
      expect(result.criterionId).toBe('crit-unknown');

      const queue = adapter.getTaskQueue();
      expect(queue.find((t) => t.criterionId === 'crit-unknown')).toBeDefined();
    });

    test('returns failure when tool is unavailable', async () => {
      const noToolAdapter = new OpenClawAdapter(makeConfig(), {});
      await noToolAdapter.initialize(makeCell(), makeBlueprint());

      const result = await noToolAdapter.evolve(makeGap());
      expect(result.success).toBe(false);
      expect(result.summary).toContain('No coding tool available');
    });

    test('returns failure when tool execution throws', async () => {
      const failTool = makeMockTool({ shouldThrow: true });
      const failAdapter = new OpenClawAdapter(makeConfig(), { codingTool: failTool });
      await failAdapter.initialize(makeCell(), makeBlueprint());

      const result = await failAdapter.evolve(makeGap());
      expect(result.success).toBe(false);
      expect(result.summary).toContain('Tool execution error');
    });

    test('returns failure when tool exits non-zero', async () => {
      const failTool = makeMockTool({ exitCode: 1, status: 'failed', stdout: 'Error', error: 'Process failed' });
      const failAdapter = new OpenClawAdapter(makeConfig(), { codingTool: failTool });
      await failAdapter.initialize(makeCell(), makeBlueprint());

      const result = await failAdapter.evolve(makeGap());
      expect(result.success).toBe(false);
    });

    test('logs task_failed on failure', async () => {
      const failTool = makeMockTool({ exitCode: 1, status: 'failed', stdout: '', error: 'Oops' });
      const failAdapter = new OpenClawAdapter(makeConfig(), { codingTool: failTool });
      await failAdapter.initialize(makeCell(), makeBlueprint());

      await failAdapter.evolve(makeGap());

      const log = failAdapter.getDecisionsLog();
      const failEntry = log.find((e) => e.type === 'task_failed');
      expect(failEntry).toBeDefined();
    });

    test('returns idle status after evolve completes', async () => {
      await adapter.evolve(makeGap());
      expect(adapter.status().state).toBe('idle');
    });
  });

  describe('stop', () => {
    beforeEach(async () => {
      await adapter.initialize(makeCell(), makeBlueprint());
    });

    test('sets stopped status', async () => {
      await adapter.stop();
      const s = adapter.status();
      expect(s.state).toBe('stopped');
      if (s.state === 'stopped') {
        expect(s.reason).toBe('User requested stop');
      }
    });

    test('logs stop decision', async () => {
      await adapter.stop();
      const log = adapter.getDecisionsLog();
      expect(log.some((e) => e.type === 'stopped')).toBe(true);
    });

    test('evolve returns failure after stop', async () => {
      await adapter.stop();
      const result = await adapter.evolve(makeGap());
      expect(result.success).toBe(false);
      expect(result.summary).toContain('stopped');
    });
  });

  describe('onBlueprintUpdate', () => {
    beforeEach(async () => {
      await adapter.initialize(makeCell(), makeBlueprint());
    });

    test('re-runs gap analysis and updates task queue', async () => {
      // Complete a task first
      await adapter.evolve(makeGap({ criterionId: 'crit-001' }));

      // Update blueprint — add a new unmet criterion
      const updated = makeBlueprint({
        criteria: [
          makeCriterion({ id: 'crit-001', met: true }),
          makeCriterion({ id: 'crit-002', priority: 2 }),
          makeCriterion({ id: 'crit-004', description: 'Add footer', priority: 4 }),
        ],
      });

      await adapter.onBlueprintUpdate(updated);

      const queue = adapter.getTaskQueue();
      // Should have: completed crit-001 + pending crit-002 + pending crit-004
      expect(queue.some((t) => t.criterionId === 'crit-001' && t.completed)).toBe(true);
      expect(queue.some((t) => t.criterionId === 'crit-002' && !t.completed)).toBe(true);
      expect(queue.some((t) => t.criterionId === 'crit-004' && !t.completed)).toBe(true);
    });

    test('logs blueprint_updated decision', async () => {
      await adapter.onBlueprintUpdate(makeBlueprint());
      const log = adapter.getDecisionsLog();
      expect(log.some((e) => e.type === 'blueprint_updated')).toBe(true);
    });

    test('updates stored blueprint', async () => {
      const newBp = makeBlueprint({ vision: 'New vision' });
      await adapter.onBlueprintUpdate(newBp);
      expect(adapter.getBlueprint()!.vision).toBe('New vision');
    });
  });

  describe('tool resolution', () => {
    test('uses resolveTool function when provided', async () => {
      let resolvedName = '';
      const resolver = (name: string) => {
        resolvedName = name;
        return makeMockTool();
      };

      const resolverAdapter = new OpenClawAdapter(makeConfig(), { resolveTool: resolver });
      await resolverAdapter.initialize(makeCell(), makeBlueprint());
      await resolverAdapter.evolve(makeGap());

      expect(resolvedName).toBe('ralph');
    });

    test('falls back to fallback tools when primary unavailable', async () => {
      const resolvedNames: string[] = [];
      const resolver = (name: string) => {
        resolvedNames.push(name);
        if (name === 'ralph') return undefined;
        return makeMockTool();
      };

      const resolverAdapter = new OpenClawAdapter(makeConfig(), { resolveTool: resolver });
      await resolverAdapter.initialize(makeCell(), makeBlueprint());
      await resolverAdapter.evolve(makeGap());

      expect(resolvedNames).toContain('ralph');
      expect(resolvedNames).toContain('claude-code');
    });
  });
});

// ─── Tests: Factory Registration ────────────────────────────────────────────

describe('registerOpenClawAdapter', () => {
  beforeEach(() => {
    clearAgentAdapterRegistry();
  });

  test('registers openclaw adapter type', () => {
    registerOpenClawAdapter();
    const adapter = createAgentAdapter(makeConfig());
    expect(adapter).toBeDefined();
    expect(adapter).toBeInstanceOf(OpenClawAdapter);
  });

  test('createOpenClawAdapter passes config through', () => {
    const config = makeConfig({
      config: { maxTasksPerAnalysis: 5, toolTimeout: 60000 },
    });
    const adapter = createOpenClawAdapter(config) as OpenClawAdapter;
    expect(adapter).toBeInstanceOf(OpenClawAdapter);
  });

  test('registered adapter works with factory system', async () => {
    registerOpenClawAdapter();
    const adapter = createAgentAdapter(makeConfig());

    await adapter.initialize(makeCell(), makeBlueprint());
    expect(adapter.status().state).toBe('idle');
  });
});
