/**
 * ABOUTME: Integration test for EvolutionEngine.
 * Runs one full evolution version with mocked agents (no real API calls).
 * Verifies: events fire correctly, report file created, version registry updated.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EvolutionEngine, type EvolutionConfig, type EvolutionEvent } from '../../src/engine/evolution.js';
import type {
  AgentPlugin,
  AgentPluginMeta,
  AgentExecuteHandle,
  AgentExecutionResult,
  AgentDetectResult,
  AgentSetupQuestion,
} from '../../src/plugins/agents/types.js';

/** Create a mock AgentPlugin that returns preset output */
function createMockAgent(id: string, output: string): AgentPlugin {
  const meta: AgentPluginMeta = {
    id,
    name: `Mock ${id}`,
    description: 'Mock agent for testing',
    version: '1.0.0',
    author: 'test',
    defaultCommand: 'mock',
    supportsStreaming: false,
    supportsInterrupt: false,
    supportsFileContext: false,
    supportsSubagentTracing: false,
    structuredOutputFormat: undefined,
  };

  return {
    meta,
    initialize: async () => {},
    detect: async () => ({ available: true, version: '1.0.0' }) as AgentDetectResult,
    dispose: async () => {},
    isReady: async () => true,
    getSetupQuestions: () => [] as AgentSetupQuestion[],
    validateSetup: async () => null,
    validateModel: () => null,
    execute: (_prompt: string, _files: unknown, options?: Record<string, unknown>) => {
      const onStdout = options?.onStdout as ((data: string) => void) | undefined;
      if (onStdout) onStdout(output);
      const result: AgentExecutionResult = {
        stdout: output,
        stderr: '',
        exitCode: 0,
        status: 'completed',
      };
      return {
        promise: Promise.resolve(result),
        interrupt: () => {},
        kill: () => {},
      } as AgentExecuteHandle;
    },
  } as AgentPlugin;
}

// Gap analysis output: JSON task array
const GAP_ANALYSIS_OUTPUT = `
[
  {
    "id": "T-1",
    "title": "Implement user login form",
    "description": "Create a login form with email and password fields",
    "complexity": "feature",
    "criteriaIds": ["AC-1"],
    "priority": 0
  }
]
<promise>COMPLETE</promise>
`;

// Scoring output: JSON score array
const SCORING_OUTPUT = `
[
  {
    "workerId": "worker-0",
    "taskId": "T-1",
    "agentId": "mock-worker",
    "qualityScore": 82,
    "criteriaAddressed": ["AC-1"],
    "rationale": "Login form implemented correctly"
  }
]
`;

describe('EvolutionEngine integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `choraforge-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    // Write blueprint.json
    const blueprint = {
      vision: 'Build a test web app with user authentication.',
      criteria: [
        { id: 'AC-1', description: 'User can log in with email and password', priority: 'P0', met: false },
        { id: 'AC-2', description: 'User can view their profile', priority: 'P1', met: false },
      ],
      constraints: ['TypeScript only'],
      outOfScope: ['Mobile app'],
      metadata: {
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        version: 1,
      },
    };
    writeFileSync(join(tmpDir, 'blueprint.json'), JSON.stringify(blueprint, null, 2));
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  test('runs one full evolution version and emits expected events', async () => {
    const architectAgent = createMockAgent('mock-architect', GAP_ANALYSIS_OUTPUT + '\n' + SCORING_OUTPUT);
    const workerAgent = createMockAgent('mock-worker', 'Task implemented successfully.');

    const config: EvolutionConfig = {
      blueprintPath: join(tmpDir, 'blueprint.json'),
      maxVersions: 1,
      variantsPerTask: 1,
      reportsDir: join(tmpDir, 'evolution', 'reports'),
      usageLogPath: join(tmpDir, 'evolution', 'usage.jsonl'),
      cwd: tmpDir,
      routing: { 'complexity:feature': 'mock-worker' },
      defaultAgent: 'mock-worker',
      agents: { 'mock-worker': workerAgent },
      architectAgent,
      maxWorkers: 1,
    };

    const engine = new EvolutionEngine(config);
    const events: EvolutionEvent[] = [];
    engine.on((e) => events.push(e));

    await engine.start();

    // Verify events fired
    const types = events.map((e) => e.type);
    expect(types).toContain('evolution:started');
    expect(types).toContain('evolution:version-started');
    expect(types).toContain('evolution:gap-analysis');
    expect(types).toContain('evolution:variants-spawned');
    expect(types).toContain('evolution:version-complete');
    // Should end with complete (1 version = max)
    expect(types).toContain('evolution:complete');
  });

  test('creates evolution report file after one version', async () => {
    const agent = createMockAgent('mock-agent', GAP_ANALYSIS_OUTPUT + '\n' + SCORING_OUTPUT);

    const config: EvolutionConfig = {
      blueprintPath: join(tmpDir, 'blueprint.json'),
      maxVersions: 1,
      variantsPerTask: 1,
      reportsDir: join(tmpDir, 'evolution', 'reports'),
      usageLogPath: join(tmpDir, 'evolution', 'usage.jsonl'),
      cwd: tmpDir,
      routing: {},
      defaultAgent: 'mock-agent',
      agents: { 'mock-agent': agent },
      architectAgent: agent,
      maxWorkers: 1,
    };

    const engine = new EvolutionEngine(config);
    engine.on(() => {}); // no-op listener

    await engine.start();

    // Report file should exist
    const reportPath = join(tmpDir, 'evolution', 'reports', 'v0.0-to-v0.1.md');
    expect(existsSync(reportPath)).toBe(true);

    const reportContent = readFileSync(reportPath, 'utf-8');
    expect(reportContent).toContain('Evolution Report');
    expect(reportContent).toContain('v0.1');
  });

  test('updates version registry after one version', async () => {
    const agent = createMockAgent('mock-agent', GAP_ANALYSIS_OUTPUT);

    const config: EvolutionConfig = {
      blueprintPath: join(tmpDir, 'blueprint.json'),
      maxVersions: 1,
      variantsPerTask: 1,
      reportsDir: join(tmpDir, 'evolution', 'reports'),
      usageLogPath: join(tmpDir, 'evolution', 'usage.jsonl'),
      cwd: tmpDir,
      routing: {},
      defaultAgent: 'mock-agent',
      agents: { 'mock-agent': agent },
      architectAgent: agent,
      maxWorkers: 1,
    };

    const engine = new EvolutionEngine(config);
    engine.on(() => {});

    await engine.start();

    // versions.json should exist
    const versionsPath = join(tmpDir, 'evolution', 'versions.json');
    expect(existsSync(versionsPath)).toBe(true);

    const versionsData = JSON.parse(readFileSync(versionsPath, 'utf-8')) as {
      versions: Array<{ version: number; gitTag: string }>;
    };
    expect(versionsData.versions).toHaveLength(1);
    expect(versionsData.versions[0]!.version).toBe(1);
    expect(versionsData.versions[0]!.gitTag).toBe('v0.1');
  });

  test('stops gracefully when engine.stop() is called', async () => {
    const agent = createMockAgent('mock-agent', GAP_ANALYSIS_OUTPUT);

    const config: EvolutionConfig = {
      blueprintPath: join(tmpDir, 'blueprint.json'),
      maxVersions: 5,
      variantsPerTask: 1,
      reportsDir: join(tmpDir, 'evolution', 'reports'),
      usageLogPath: join(tmpDir, 'evolution', 'usage.jsonl'),
      cwd: tmpDir,
      routing: {},
      defaultAgent: 'mock-agent',
      agents: { 'mock-agent': agent },
      architectAgent: agent,
      maxWorkers: 1,
    };

    const engine = new EvolutionEngine(config);
    const events: EvolutionEvent[] = [];
    engine.on((e) => events.push(e));

    // Stop immediately after first version starts
    engine.on((e) => {
      if (e.type === 'evolution:version-started' && e.version === 1) {
        engine.stop();
      }
    });

    await engine.start();

    const types = events.map((e) => e.type);
    expect(types).toContain('evolution:stopped');
  });

  test('loads blueprint.json format (Phase 3 JSON files)', async () => {
    const agent = createMockAgent('mock-agent', '[]');

    const config: EvolutionConfig = {
      blueprintPath: join(tmpDir, 'blueprint.json'),
      maxVersions: 1,
      variantsPerTask: 1,
      reportsDir: join(tmpDir, 'evolution', 'reports'),
      usageLogPath: join(tmpDir, 'evolution', 'usage.jsonl'),
      cwd: tmpDir,
      routing: {},
      defaultAgent: 'mock-agent',
      agents: { 'mock-agent': agent },
      architectAgent: agent,
      maxWorkers: 1,
    };

    const engine = new EvolutionEngine(config);
    const events: EvolutionEvent[] = [];
    engine.on((e) => events.push(e));

    await engine.start();

    // Should have started (blueprint loaded successfully)
    expect(events.some((e) => e.type === 'evolution:started')).toBe(true);
    // No error events
    expect(events.some((e) => e.type === 'evolution:error')).toBe(false);
  });
});
