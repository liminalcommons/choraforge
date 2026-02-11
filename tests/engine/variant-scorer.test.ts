/**
 * ABOUTME: Tests for the VariantScorer.
 * Tests score parsing, variant selection, and fallback behavior.
 */

import { describe, test, expect } from 'bun:test';
import { VariantScorer } from '../../src/engine/variant-scorer.js';
import type { VariantDiff, VariantScorerConfig } from '../../src/engine/variant-scorer.js';
import type { Blueprint } from '../../src/commands/blueprint.js';
import type {
  AgentPlugin,
  AgentPluginMeta,
  AgentExecuteHandle,
  AgentExecutionResult,
  AgentDetectResult,
  AgentSetupQuestion,
} from '../../src/plugins/agents/types.js';

/**
 * Create a mock agent that returns the given output when executed.
 */
function createMockScoringAgent(output: string): AgentPlugin {
  return {
    meta: {
      id: 'mock-scorer',
      name: 'Mock Scorer',
      description: 'Mock agent for testing',
      version: '1.0.0',
      author: 'test',
      defaultCommand: 'mock',
      supportsStreaming: false,
      supportsInterrupt: false,
      supportsFileContext: false,
      supportsSubagentTracing: false,
      structuredOutputFormat: undefined,
    } as AgentPluginMeta,
    initialize: async () => {},
    detect: async () => ({ available: true }) as AgentDetectResult,
    dispose: async () => {},
    isReady: async () => true,
    getSetupQuestions: () => [] as AgentSetupQuestion[],
    validateSetup: async () => null,
    validateModel: () => null,
    execute: (_prompt: string, _files: unknown, options?: Record<string, unknown>) => {
      // Call onStdout callback if provided (the scorer accumulates output via this)
      const onStdout = options?.onStdout as ((data: string) => void) | undefined;
      if (onStdout) {
        onStdout(output);
      }
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

function createTestBlueprint(): Blueprint {
  return {
    vision: 'Build a test app.',
    criteria: [
      { id: 'AC-1', description: 'Users can create tasks', priority: 'P0', met: false },
      { id: 'AC-2', description: 'Tasks have due dates', priority: 'P1', met: false },
      { id: 'AC-3', description: 'UI looks good', priority: 'P2', met: true },
    ],
    constraints: ['TypeScript only'],
    outOfScope: ['Mobile'],
    metadata: {
      createdAt: '2026-01-01T00:00:00Z',
      lastModified: '2026-01-01T00:00:00Z',
      version: 1,
    },
  };
}

function createTestVariants(): VariantDiff[] {
  return [
    { workerId: 'worker-0', taskId: 'AC-1', agentId: 'kimi', diff: '+task creation code', commitCount: 2 },
    { workerId: 'worker-1', taskId: 'AC-1', agentId: 'glm', diff: '+alternative task code', commitCount: 1 },
  ];
}

describe('VariantScorer', () => {
  describe('score', () => {
    test('returns empty array for no variants', async () => {
      const scorer = new VariantScorer({
        scoringAgent: createMockScoringAgent('[]'),
        cwd: '/tmp',
      });

      const scores = await scorer.score([], createTestBlueprint());
      expect(scores).toEqual([]);
    });

    test('parses valid JSON scoring output', async () => {
      const scoringOutput = JSON.stringify([
        {
          workerId: 'worker-0',
          criteriaAddressed: ['AC-1'],
          qualityScore: 85,
          rationale: 'Solid implementation of task creation',
          recommended: true,
        },
        {
          workerId: 'worker-1',
          criteriaAddressed: ['AC-1'],
          qualityScore: 60,
          rationale: 'Partial implementation, missing validation',
          recommended: false,
        },
      ]);

      const scorer = new VariantScorer({
        scoringAgent: createMockScoringAgent(scoringOutput),
        cwd: '/tmp',
      });

      const scores = await scorer.score(createTestVariants(), createTestBlueprint());

      expect(scores).toHaveLength(2);
      // Sorted by qualityScore descending
      expect(scores[0]!.qualityScore).toBe(85);
      expect(scores[0]!.workerId).toBe('worker-0');
      expect(scores[0]!.criteriaAddressed).toEqual(['AC-1']);
      expect(scores[0]!.recommended).toBe(true);

      expect(scores[1]!.qualityScore).toBe(60);
      expect(scores[1]!.recommended).toBe(false);
    });

    test('falls back to equal scores on unparseable output', async () => {
      const scorer = new VariantScorer({
        scoringAgent: createMockScoringAgent('This is not JSON at all, just prose.'),
        cwd: '/tmp',
      });

      const variants = createTestVariants();
      const scores = await scorer.score(variants, createTestBlueprint());

      expect(scores).toHaveLength(2);
      for (const score of scores) {
        expect(score.qualityScore).toBe(50);
        expect(score.recommended).toBe(true);
        expect(score.rationale).toContain('could not be parsed');
      }
    });

    test('falls back on malformed JSON', async () => {
      const scorer = new VariantScorer({
        scoringAgent: createMockScoringAgent('[{"workerId": "worker-0", broken json}]'),
        cwd: '/tmp',
      });

      const scores = await scorer.score(createTestVariants(), createTestBlueprint());

      expect(scores).toHaveLength(2);
      expect(scores[0]!.rationale).toContain('parse error');
    });

    test('sorts results by qualityScore descending', async () => {
      const scoringOutput = JSON.stringify([
        { workerId: 'worker-0', qualityScore: 40, recommended: true },
        { workerId: 'worker-1', qualityScore: 90, recommended: true },
      ]);

      const scorer = new VariantScorer({
        scoringAgent: createMockScoringAgent(scoringOutput),
        cwd: '/tmp',
      });

      const scores = await scorer.score(createTestVariants(), createTestBlueprint());
      expect(scores[0]!.qualityScore).toBe(90);
      expect(scores[1]!.qualityScore).toBe(40);
    });

    test('handles missing fields in scoring output', async () => {
      const scoringOutput = JSON.stringify([
        { workerId: 'worker-0' },
        { workerId: 'worker-1', qualityScore: 75 },
      ]);

      const scorer = new VariantScorer({
        scoringAgent: createMockScoringAgent(scoringOutput),
        cwd: '/tmp',
      });

      const scores = await scorer.score(createTestVariants(), createTestBlueprint());

      // Missing qualityScore defaults to 50
      const worker0Score = scores.find(s => s.workerId === 'worker-0');
      expect(worker0Score!.qualityScore).toBe(50);
      expect(worker0Score!.criteriaAddressed).toEqual([]);
      expect(worker0Score!.rationale).toBe('');
      // Missing recommended defaults to true
      expect(worker0Score!.recommended).toBe(true);
    });

    test('extracts JSON from surrounding prose', async () => {
      const scoringOutput = `Here's my evaluation of the variants:

[
  {
    "workerId": "worker-0",
    "criteriaAddressed": ["AC-1"],
    "qualityScore": 82,
    "rationale": "Good",
    "recommended": true
  }
]

Overall, worker-0 is the best choice.`;

      const scorer = new VariantScorer({
        scoringAgent: createMockScoringAgent(scoringOutput),
        cwd: '/tmp',
      });

      const scores = await scorer.score(
        [createTestVariants()[0]!],
        createTestBlueprint()
      );
      expect(scores).toHaveLength(1);
      expect(scores[0]!.qualityScore).toBe(82);
    });
  });

  describe('selectBest', () => {
    test('selects highest-scoring recommended variant', () => {
      const scorer = new VariantScorer({
        scoringAgent: createMockScoringAgent(''),
        cwd: '/tmp',
      });

      const best = scorer.selectBest([
        { workerId: 'w-0', taskId: 't1', agentId: 'kimi', diff: '', criteriaAddressed: ['AC-1'], qualityScore: 90, rationale: '', recommended: true },
        { workerId: 'w-1', taskId: 't1', agentId: 'glm', diff: '', criteriaAddressed: ['AC-1'], qualityScore: 70, rationale: '', recommended: true },
      ]);

      expect(best).not.toBeNull();
      expect(best!.workerId).toBe('w-0');
    });

    test('returns null when no variants are recommended', () => {
      const scorer = new VariantScorer({
        scoringAgent: createMockScoringAgent(''),
        cwd: '/tmp',
      });

      const best = scorer.selectBest([
        { workerId: 'w-0', taskId: 't1', agentId: 'kimi', diff: '', criteriaAddressed: [], qualityScore: 20, rationale: 'Poor', recommended: false },
      ]);

      expect(best).toBeNull();
    });

    test('returns null for empty array', () => {
      const scorer = new VariantScorer({
        scoringAgent: createMockScoringAgent(''),
        cwd: '/tmp',
      });

      expect(scorer.selectBest([])).toBeNull();
    });
  });
});
