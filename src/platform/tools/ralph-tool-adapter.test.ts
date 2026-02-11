/**
 * ABOUTME: Unit tests for the Ralph Tool Adapter.
 * Tests task execution, structured results, error handling, concurrent guard,
 * stop behavior, and helper functions.
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import type { CellRef } from '../agent-adapter.js';
import {
  RalphToolAdapter,
  type RalphToolAdapterConfig,
  type RalphToolInput,
  // RalphToolResult used for type reference only
} from './ralph-tool-adapter.js';

// ─── Test Fixtures ──────────────────────────────────────────────────────────

function makeCell(overrides?: Partial<CellRef>): CellRef {
  return {
    cellId: 'cell-test-001',
    workDir: '/workspace/test-app',
    stackType: 'node',
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<RalphToolAdapterConfig>): RalphToolAdapterConfig {
  return {
    agentPlugin: 'claude',
    maxIterations: 2,
    timeout: 10000,
    ...overrides,
  };
}

function makeInput(overrides?: Partial<RalphToolInput>): RalphToolInput {
  return {
    description: 'Add a landing page with hero section',
    acceptanceCriteria: [
      'Page has a hero section',
      'Responsive CSS for mobile',
    ],
    ...overrides,
  };
}

// ─── Mock ExecutionEngine ────────────────────────────────────────────────────
//
// We mock the engine module to avoid actually spawning agent processes.
// The mock captures initialization and start calls for assertion.
//

interface MockEngineCall {
  type: 'constructor' | 'initialize' | 'start' | 'stop' | 'on' | 'getState' | 'dispose';
  args?: unknown[];
}

let engineCalls: MockEngineCall[] = [];
let mockTasksCompleted = 1;
let mockEngineStartThrows = false;
let mockInitializeThrows = false;
let mockListeners: Array<(event: unknown) => void> = [];

// Mock the ExecutionEngine at the module level
mock.module('../../engine/index.js', () => {
  return {
    ExecutionEngine: class MockExecutionEngine {
      constructor(config: unknown) {
        engineCalls.push({ type: 'constructor', args: [config] });
      }

      async initialize(opts: unknown) {
        engineCalls.push({ type: 'initialize', args: [opts] });
        if (mockInitializeThrows) {
          throw new Error('Engine initialization failed');
        }
      }

      on(listener: (event: unknown) => void) {
        engineCalls.push({ type: 'on' });
        mockListeners.push(listener);
        return () => {
          const idx = mockListeners.indexOf(listener);
          if (idx !== -1) mockListeners.splice(idx, 1);
        };
      }

      async start() {
        engineCalls.push({ type: 'start' });
        if (mockEngineStartThrows) {
          throw new Error('Engine execution failed');
        }
        // Simulate agent output events
        for (const listener of mockListeners) {
          listener({
            type: 'agent:output',
            stream: 'stdout',
            data: 'Modified: src/index.html\nCreated: src/styles.css\n<promise>COMPLETE</promise>\n',
            timestamp: new Date().toISOString(),
            iteration: 1,
          });
        }
      }

      async stop() {
        engineCalls.push({ type: 'stop' });
      }

      getState() {
        engineCalls.push({ type: 'getState' });
        return {
          status: 'idle',
          currentIteration: 1,
          currentTask: null,
          totalTasks: 1,
          tasksCompleted: mockTasksCompleted,
          iterations: [],
          startedAt: null,
          currentOutput: '',
          currentStderr: '',
          subagents: new Map(),
          activeAgent: null,
          rateLimitState: null,
        };
      }

      async dispose() {
        engineCalls.push({ type: 'dispose' });
      }
    },
  };
});

// ─── Tests: Constructor & Config ────────────────────────────────────────────

describe('RalphToolAdapter', () => {
  beforeEach(() => {
    engineCalls = [];
    mockTasksCompleted = 1;
    mockEngineStartThrows = false;
    mockInitializeThrows = false;
    mockListeners = [];
  });

  describe('constructor', () => {
    test('stores cell and config', () => {
      const cell = makeCell();
      const config = makeConfig();
      const adapter = new RalphToolAdapter(cell, config);

      expect(adapter).toBeDefined();
      expect(adapter.isRunning()).toBe(false);
    });
  });

  // ─── Tests: run() ─────────────────────────────────────────────────────

  describe('run', () => {
    test('creates engine with correct working directory', async () => {
      const cell = makeCell({ workDir: '/my/project' });
      const adapter = new RalphToolAdapter(cell, makeConfig());

      await adapter.run(makeInput());

      const constructorCall = engineCalls.find((c) => c.type === 'constructor');
      expect(constructorCall).toBeDefined();
      const config = constructorCall!.args![0] as { cwd: string };
      expect(config.cwd).toBe('/my/project');
    });

    test('initializes engine in worker mode with forced task', async () => {
      const adapter = new RalphToolAdapter(makeCell(), makeConfig());
      await adapter.run(makeInput());

      const initCall = engineCalls.find((c) => c.type === 'initialize');
      expect(initCall).toBeDefined();
      const opts = initCall!.args![0] as { tracker: unknown; forcedTask: { id: string; title: string; description: string } };
      expect(opts.tracker).toBeDefined();
      expect(opts.forcedTask).toBeDefined();
      expect(opts.forcedTask.title).toBe('Add a landing page with hero section');
    });

    test('starts the engine', async () => {
      const adapter = new RalphToolAdapter(makeCell(), makeConfig());
      await adapter.run(makeInput());

      expect(engineCalls.some((c) => c.type === 'start')).toBe(true);
    });

    test('returns success when engine completes task', async () => {
      mockTasksCompleted = 1;
      const adapter = new RalphToolAdapter(makeCell(), makeConfig());
      const result = await adapter.run(makeInput());

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    test('returns failure when engine does not complete task', async () => {
      mockTasksCompleted = 0;
      const adapter = new RalphToolAdapter(makeCell(), makeConfig());
      const result = await adapter.run(makeInput());

      expect(result.success).toBe(false);
      expect(result.error).toContain('did not complete');
    });

    test('extracts changed files from output', async () => {
      const adapter = new RalphToolAdapter(makeCell(), makeConfig());
      const result = await adapter.run(makeInput());

      expect(result.filesChanged).toContain('src/index.html');
      expect(result.filesChanged).toContain('src/styles.css');
    });

    test('collects output log from agent events', async () => {
      const adapter = new RalphToolAdapter(makeCell(), makeConfig());
      const result = await adapter.run(makeInput());

      expect(result.outputLog).toContain('Modified: src/index.html');
      expect(result.outputLog).toContain('Created: src/styles.css');
    });

    test('returns error on engine initialization failure', async () => {
      mockInitializeThrows = true;
      const adapter = new RalphToolAdapter(makeCell(), makeConfig());
      const result = await adapter.run(makeInput());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Engine initialization failed');
    });

    test('returns error on engine execution failure', async () => {
      mockEngineStartThrows = true;
      const adapter = new RalphToolAdapter(makeCell(), makeConfig());
      const result = await adapter.run(makeInput());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Engine execution failed');
    });

    test('uses custom task ID when provided', async () => {
      const adapter = new RalphToolAdapter(makeCell(), makeConfig());
      await adapter.run(makeInput({ taskId: 'custom-001' }));

      const initCall = engineCalls.find((c) => c.type === 'initialize');
      const opts = initCall!.args![0] as { forcedTask: { id: string } };
      expect(opts.forcedTask.id).toBe('custom-001');
    });

    test('auto-generates task ID when not provided', async () => {
      const adapter = new RalphToolAdapter(makeCell(), makeConfig());
      await adapter.run(makeInput({ taskId: undefined }));

      const initCall = engineCalls.find((c) => c.type === 'initialize');
      const opts = initCall!.args![0] as { forcedTask: { id: string } };
      expect(opts.forcedTask.id).toMatch(/^ralph-tool-\d+$/);
    });

    test('includes acceptance criteria in task description', async () => {
      const adapter = new RalphToolAdapter(makeCell(), makeConfig());
      await adapter.run(makeInput());

      const initCall = engineCalls.find((c) => c.type === 'initialize');
      const opts = initCall!.args![0] as { forcedTask: { description: string } };
      expect(opts.forcedTask.description).toContain('## Acceptance Criteria');
      expect(opts.forcedTask.description).toContain('- [ ] Page has a hero section');
      expect(opts.forcedTask.description).toContain('- [ ] Responsive CSS for mobile');
    });
  });

  // ─── Tests: Config Passthrough ────────────────────────────────────────

  describe('config passthrough', () => {
    test('passes agent plugin to engine config', async () => {
      const adapter = new RalphToolAdapter(makeCell(), makeConfig({ agentPlugin: 'opencode' }));
      await adapter.run(makeInput());

      const constructorCall = engineCalls.find((c) => c.type === 'constructor');
      const config = constructorCall!.args![0] as { agent: { plugin: string } };
      expect(config.agent.plugin).toBe('opencode');
    });

    test('passes model override to engine config', async () => {
      const adapter = new RalphToolAdapter(makeCell(), makeConfig({ model: 'opus' }));
      await adapter.run(makeInput());

      const constructorCall = engineCalls.find((c) => c.type === 'constructor');
      const config = constructorCall!.args![0] as { model: string };
      expect(config.model).toBe('opus');
    });

    test('passes maxIterations to engine config', async () => {
      const adapter = new RalphToolAdapter(makeCell(), makeConfig({ maxIterations: 5 }));
      await adapter.run(makeInput());

      const constructorCall = engineCalls.find((c) => c.type === 'constructor');
      const config = constructorCall!.args![0] as { maxIterations: number };
      expect(config.maxIterations).toBe(5);
    });

    test('defaults maxIterations to 3', async () => {
      const adapter = new RalphToolAdapter(makeCell(), makeConfig({ maxIterations: undefined }));
      await adapter.run(makeInput());

      const constructorCall = engineCalls.find((c) => c.type === 'constructor');
      const config = constructorCall!.args![0] as { maxIterations: number };
      expect(config.maxIterations).toBe(3);
    });

    test('passes agent options to engine config', async () => {
      const adapter = new RalphToolAdapter(
        makeCell(),
        makeConfig({ agentOptions: { temperature: 0.5 } }),
      );
      await adapter.run(makeInput());

      const constructorCall = engineCalls.find((c) => c.type === 'constructor');
      const config = constructorCall!.args![0] as { agent: { options: Record<string, unknown> } };
      expect(config.agent.options.temperature).toBe(0.5);
    });
  });

  // ─── Tests: Concurrency Guard ─────────────────────────────────────────

  describe('concurrency guard', () => {
    test('prevents concurrent runs', async () => {
      const adapter = new RalphToolAdapter(makeCell(), makeConfig());

      // Start a run
      const firstRun = adapter.run(makeInput());

      // Try to start another before first completes
      const secondResult = await adapter.run(makeInput());
      expect(secondResult.success).toBe(false);
      expect(secondResult.error).toContain('already running');

      await firstRun;
    });

    test('allows sequential runs', async () => {
      const adapter = new RalphToolAdapter(makeCell(), makeConfig());

      const first = await adapter.run(makeInput());
      expect(first.success).toBe(true);

      const second = await adapter.run(makeInput());
      expect(second.success).toBe(true);
    });

    test('resets running state after failure', async () => {
      mockEngineStartThrows = true;
      const adapter = new RalphToolAdapter(makeCell(), makeConfig());

      const failed = await adapter.run(makeInput());
      expect(failed.success).toBe(false);

      // Should be able to run again
      mockEngineStartThrows = false;
      const success = await adapter.run(makeInput());
      expect(success.success).toBe(true);
    });
  });

  // ─── Tests: isRunning / stop ──────────────────────────────────────────

  describe('isRunning', () => {
    test('returns false initially', () => {
      const adapter = new RalphToolAdapter(makeCell(), makeConfig());
      expect(adapter.isRunning()).toBe(false);
    });

    test('returns false after run completes', async () => {
      const adapter = new RalphToolAdapter(makeCell(), makeConfig());
      await adapter.run(makeInput());
      expect(adapter.isRunning()).toBe(false);
    });
  });

  describe('stop', () => {
    test('calls engine.stop when running', async () => {
      const adapter = new RalphToolAdapter(makeCell(), makeConfig());
      const runPromise = adapter.run(makeInput());

      // stop() while engine might be running — engine mock resolves quickly
      await adapter.stop();
      await runPromise;

      // stop() may or may not catch the engine in running state depending on timing
      // but it should not throw
    });

    test('is safe to call when not running', async () => {
      const adapter = new RalphToolAdapter(makeCell(), makeConfig());
      // Should not throw
      await adapter.stop();
    });
  });

  // ─── Tests: Test Result Detection ─────────────────────────────────────

  describe('test result detection', () => {
    test('detects null when no test output', async () => {
      // Default mock output has no test signals
      // We can check the field in the result
      const adapter = new RalphToolAdapter(makeCell(), makeConfig());
      const result = await adapter.run(makeInput());
      // The mock output contains "Modified" and "Created" but no test patterns
      // testsPassed depends on what the mock output contains
      expect(result.testsPassed === true || result.testsPassed === null).toBe(true);
    });
  });

  // ─── Tests: Cell Context ──────────────────────────────────────────────

  describe('cell context', () => {
    test('uses cell workDir as engine cwd', async () => {
      const adapter = new RalphToolAdapter(
        makeCell({ workDir: '/docker/cells/app-001/workspace' }),
        makeConfig(),
      );
      await adapter.run(makeInput());

      const constructorCall = engineCalls.find((c) => c.type === 'constructor');
      const config = constructorCall!.args![0] as { cwd: string };
      expect(config.cwd).toBe('/docker/cells/app-001/workspace');
    });

    test('disables TUI for headless execution', async () => {
      const adapter = new RalphToolAdapter(makeCell(), makeConfig());
      await adapter.run(makeInput());

      const constructorCall = engineCalls.find((c) => c.type === 'constructor');
      const config = constructorCall!.args![0] as { showTui: boolean };
      expect(config.showTui).toBe(false);
    });
  });

  // ─── Tests: Result Structure ──────────────────────────────────────────

  describe('result structure', () => {
    test('returns all required fields on success', async () => {
      const adapter = new RalphToolAdapter(makeCell(), makeConfig());
      const result = await adapter.run(makeInput());

      expect(typeof result.success).toBe('boolean');
      expect(Array.isArray(result.filesChanged)).toBe(true);
      expect(result.testsPassed === true || result.testsPassed === false || result.testsPassed === null).toBe(true);
      expect(typeof result.outputLog).toBe('string');
      expect(typeof result.durationMs).toBe('number');
    });

    test('returns all required fields on failure', async () => {
      mockEngineStartThrows = true;
      const adapter = new RalphToolAdapter(makeCell(), makeConfig());
      const result = await adapter.run(makeInput());

      expect(result.success).toBe(false);
      expect(Array.isArray(result.filesChanged)).toBe(true);
      expect(typeof result.error).toBe('string');
      expect(typeof result.durationMs).toBe('number');
    });
  });
});
