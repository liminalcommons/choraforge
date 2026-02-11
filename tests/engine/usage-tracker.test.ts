/**
 * ABOUTME: Tests for the UsageTracker.
 * Tests per-model capacity tracking, rate limit handling, cooldowns, and JSONL logging.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { UsageTracker } from '../../src/engine/usage-tracker.js';
import type { UsageTrackerConfig, UsageLogEntry } from '../../src/engine/usage-tracker.js';

const TEST_DIR = join(process.cwd(), '.test-usage-tracker-tmp');
const LOG_PATH = join(TEST_DIR, 'usage-log.jsonl');

function createTestConfig(overrides?: Partial<UsageTrackerConfig>): UsageTrackerConfig {
  return {
    logPath: LOG_PATH,
    models: {
      opus: { method: 'rate-limit-detect', rateLimitCooldownMs: 100 },
      kimi: { method: 'api-balance', rateLimitCooldownMs: 50 },
      glm: { method: 'always-available' },
    },
    ...overrides,
  };
}

describe('UsageTracker', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('initialization', () => {
    test('creates log directory if it does not exist', () => {
      expect(existsSync(TEST_DIR)).toBe(false);
      new UsageTracker(createTestConfig());
      expect(existsSync(TEST_DIR)).toBe(true);
    });

    test('all models start as available', () => {
      const tracker = new UsageTracker(createTestConfig());
      expect(tracker.anyAvailable()).toBe(true);
      expect(tracker.getAvailableModels()).toEqual(['opus', 'kimi', 'glm']);
    });

    test('initializes capacity state per model', () => {
      const tracker = new UsageTracker(createTestConfig());

      const opus = tracker.getCapacity('opus');
      expect(opus).toBeDefined();
      expect(opus!.id).toBe('opus');
      expect(opus!.available).toBe(true);
      expect(opus!.method).toBe('rate-limit-detect');
      expect(opus!.totalInvocations).toBe(0);
      expect(opus!.totalTokensEstimate).toBe(0);

      const glm = tracker.getCapacity('glm');
      expect(glm!.method).toBe('always-available');
    });

    test('returns undefined for unknown model', () => {
      const tracker = new UsageTracker(createTestConfig());
      expect(tracker.getCapacity('nonexistent')).toBeUndefined();
    });
  });

  describe('rate limiting', () => {
    test('markRateLimited makes model unavailable', () => {
      const tracker = new UsageTracker(createTestConfig());
      tracker.markRateLimited('opus');

      expect(tracker.getCapacity('opus')!.available).toBe(false);
      expect(tracker.getCapacity('opus')!.rateLimitedAt).toBeDefined();
      expect(tracker.getCapacity('opus')!.rateLimitedUntil).toBeDefined();
    });

    test('rate-limited model is excluded from available models', () => {
      const tracker = new UsageTracker(createTestConfig());
      tracker.markRateLimited('opus');

      const available = tracker.getAvailableModels();
      expect(available).not.toContain('opus');
      expect(available).toContain('kimi');
      expect(available).toContain('glm');
    });

    test('anyAvailable returns true when some models still available', () => {
      const tracker = new UsageTracker(createTestConfig());
      tracker.markRateLimited('opus');
      expect(tracker.anyAvailable()).toBe(true);
    });

    test('anyAvailable returns false when all models rate-limited', () => {
      const tracker = new UsageTracker(createTestConfig());
      tracker.markRateLimited('opus');
      tracker.markRateLimited('kimi');
      tracker.markRateLimited('glm');
      expect(tracker.anyAvailable()).toBe(false);
    });

    test('markAvailable restores model availability', () => {
      const tracker = new UsageTracker(createTestConfig());
      tracker.markRateLimited('opus');
      expect(tracker.getCapacity('opus')!.available).toBe(false);

      tracker.markAvailable('opus');
      expect(tracker.getCapacity('opus')!.available).toBe(true);
      expect(tracker.getCapacity('opus')!.rateLimitedAt).toBeUndefined();
      expect(tracker.getCapacity('opus')!.rateLimitedUntil).toBeUndefined();
    });

    test('cooldown auto-recovers model after timeout', async () => {
      const tracker = new UsageTracker(createTestConfig({
        models: {
          opus: { method: 'rate-limit-detect', rateLimitCooldownMs: 50 },
        },
      }));

      tracker.markRateLimited('opus');
      expect(tracker.getAvailableModels()).toEqual([]);

      // Wait for cooldown
      await new Promise(resolve => setTimeout(resolve, 80));

      expect(tracker.getAvailableModels()).toEqual(['opus']);
      expect(tracker.getCapacity('opus')!.available).toBe(true);
    });

    test('markRateLimited is no-op for unknown model', () => {
      const tracker = new UsageTracker(createTestConfig());
      tracker.markRateLimited('nonexistent'); // Should not throw
      expect(tracker.anyAvailable()).toBe(true);
    });

    test('markAvailable is no-op for unknown model', () => {
      const tracker = new UsageTracker(createTestConfig());
      tracker.markAvailable('nonexistent'); // Should not throw
    });
  });

  describe('usage recording', () => {
    test('recordUsage increments invocation count', () => {
      const tracker = new UsageTracker(createTestConfig());

      tracker.recordUsage({
        timestamp: new Date().toISOString(),
        agent: 'opus',
        taskId: 'task-1',
        action: 'complete',
      });

      expect(tracker.getCapacity('opus')!.totalInvocations).toBe(1);
    });

    test('recordUsage accumulates tokens estimate', () => {
      const tracker = new UsageTracker(createTestConfig());

      tracker.recordUsage({
        timestamp: new Date().toISOString(),
        agent: 'kimi',
        taskId: 'task-1',
        action: 'complete',
        tokensEstimate: 1000,
      });
      tracker.recordUsage({
        timestamp: new Date().toISOString(),
        agent: 'kimi',
        taskId: 'task-2',
        action: 'complete',
        tokensEstimate: 500,
      });

      expect(tracker.getCapacity('kimi')!.totalTokensEstimate).toBe(1500);
      expect(tracker.getCapacity('kimi')!.totalInvocations).toBe(2);
    });

    test('recordUsage updates lastUsed timestamp', () => {
      const tracker = new UsageTracker(createTestConfig());

      expect(tracker.getCapacity('opus')!.lastUsed).toBeUndefined();

      tracker.recordUsage({
        timestamp: new Date().toISOString(),
        agent: 'opus',
        taskId: 'task-1',
        action: 'start',
      });

      expect(tracker.getCapacity('opus')!.lastUsed).toBeDefined();
    });

    test('recordUsage writes to JSONL log file', () => {
      const tracker = new UsageTracker(createTestConfig());

      tracker.recordUsage({
        timestamp: '2026-01-01T00:00:00Z',
        agent: 'opus',
        taskId: 'task-1',
        action: 'complete',
        tokensEstimate: 500,
      });

      expect(existsSync(LOG_PATH)).toBe(true);
      const content = readFileSync(LOG_PATH, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(1);

      const entry = JSON.parse(lines[0]!) as UsageLogEntry;
      expect(entry.agent).toBe('opus');
      expect(entry.taskId).toBe('task-1');
      expect(entry.action).toBe('complete');
    });
  });

  describe('getSummary', () => {
    test('returns summary for all models', () => {
      const tracker = new UsageTracker(createTestConfig());

      tracker.recordUsage({
        timestamp: new Date().toISOString(),
        agent: 'opus',
        taskId: 'task-1',
        action: 'complete',
        tokensEstimate: 1000,
      });
      tracker.markRateLimited('kimi');

      const summary = tracker.getSummary();

      expect(summary.opus).toEqual({
        invocations: 1,
        tokensEstimate: 1000,
        available: true,
      });
      expect(summary.kimi!.available).toBe(false);
      expect(summary.glm!.available).toBe(true);
      expect(summary.glm!.invocations).toBe(0);
    });
  });

  describe('loadLog', () => {
    test('returns empty array when no log file', () => {
      const tracker = new UsageTracker(createTestConfig());
      const entries = tracker.loadLog();
      expect(entries).toEqual([]);
    });

    test('loads entries from JSONL file', () => {
      const tracker = new UsageTracker(createTestConfig());

      tracker.recordUsage({
        timestamp: '2026-01-01T00:00:00Z',
        agent: 'opus',
        taskId: 'task-1',
        action: 'start',
      });
      tracker.recordUsage({
        timestamp: '2026-01-01T00:01:00Z',
        agent: 'opus',
        taskId: 'task-1',
        action: 'complete',
        durationMs: 5000,
      });

      const entries = tracker.loadLog();
      expect(entries).toHaveLength(2);
      expect(entries[0]!.action).toBe('start');
      expect(entries[1]!.action).toBe('complete');
      expect(entries[1]!.durationMs).toBe(5000);
    });

    test('skips malformed JSON lines', () => {
      mkdirSync(TEST_DIR, { recursive: true });
      const { writeFileSync: wfs } = require('node:fs');
      wfs(LOG_PATH, '{"agent":"opus","taskId":"t1","action":"start","timestamp":"now"}\nnot json\n{"agent":"kimi","taskId":"t2","action":"complete","timestamp":"now"}\n');

      const tracker = new UsageTracker(createTestConfig());
      const entries = tracker.loadLog();
      expect(entries).toHaveLength(2);
    });
  });
});
