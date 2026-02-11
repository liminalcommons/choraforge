/**
 * ABOUTME: Tests for the EvolutionTrackerPlugin.
 * Tests blueprint-driven task generation, completion tracking, and filtering.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { EvolutionTrackerPlugin } from '../../src/plugins/trackers/builtin/evolution/index.js';

const TEST_DIR = join(process.cwd(), '.test-evolution-tracker-tmp');

function createTestBlueprintFile(): string {
  const dir = join(TEST_DIR, 'evolution');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'blueprint.md');

  writeFileSync(path, `# Vision
Build a collaborative note-taking app.

# Acceptance Criteria
- AC-1 [P0]: Users can create notes
- AC-2 [P0]: Notes support markdown formatting
- AC-3 [P1]: Notes can be shared between users
- AC-4 [P2]: Themes can be customized

# Constraints
- Must use TypeScript
- Must use React

# Out of Scope
- Mobile native app
`);

  return path;
}

describe('EvolutionTrackerPlugin', () => {
  let plugin: EvolutionTrackerPlugin;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    plugin = new EvolutionTrackerPlugin();
  });

  afterEach(async () => {
    await plugin.dispose();
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('metadata', () => {
    test('has correct plugin ID', () => {
      expect(plugin.meta.id).toBe('evolution');
    });

    test('has correct name', () => {
      expect(plugin.meta.name).toBe('Evolution Tracker');
    });

    test('does not support bidirectional sync', () => {
      expect(plugin.meta.supportsBidirectionalSync).toBe(false);
    });

    test('does not support hierarchy', () => {
      expect(plugin.meta.supportsHierarchy).toBe(false);
    });

    test('does not support dependencies', () => {
      expect(plugin.meta.supportsDependencies).toBe(false);
    });
  });

  describe('initialization', () => {
    test('not ready without a valid blueprint', async () => {
      await plugin.initialize({ blueprintPath: '/nonexistent/blueprint.md' });
      expect(await plugin.isReady()).toBe(false);
    });

    test('ready with a valid blueprint', async () => {
      const path = createTestBlueprintFile();
      await plugin.initialize({ blueprintPath: path });
      expect(await plugin.isReady()).toBe(true);
    });
  });

  describe('getTasks', () => {
    test('generates tasks from blueprint criteria', async () => {
      const path = createTestBlueprintFile();
      await plugin.initialize({ blueprintPath: path });

      const tasks = await plugin.getTasks();
      expect(tasks).toHaveLength(4);

      expect(tasks[0]!.id).toBe('AC-1');
      expect(tasks[0]!.title).toBe('Users can create notes');
      expect(tasks[0]!.status).toBe('open');
      expect(tasks[0]!.priority).toBe(0); // P0 → 0

      expect(tasks[2]!.id).toBe('AC-3');
      expect(tasks[2]!.priority).toBe(1); // P1 → 1

      expect(tasks[3]!.id).toBe('AC-4');
      expect(tasks[3]!.priority).toBe(2); // P2 → 2
    });

    test('returns empty array when no blueprint loaded', async () => {
      await plugin.initialize({ blueprintPath: '/nonexistent.md' });
      const tasks = await plugin.getTasks();
      expect(tasks).toHaveLength(0);
    });

    test('filters by status', async () => {
      const path = createTestBlueprintFile();
      await plugin.initialize({ blueprintPath: path });

      // Complete AC-1
      await plugin.completeTask('AC-1');

      const openTasks = await plugin.getTasks({ status: 'open' });
      expect(openTasks).toHaveLength(3);
      expect(openTasks.find(t => t.id === 'AC-1')).toBeUndefined();

      const completedTasks = await plugin.getTasks({ status: 'completed' });
      expect(completedTasks).toHaveLength(1);
      expect(completedTasks[0]!.id).toBe('AC-1');
    });

    test('filters by excludeIds', async () => {
      const path = createTestBlueprintFile();
      await plugin.initialize({ blueprintPath: path });

      const tasks = await plugin.getTasks({ excludeIds: ['AC-1', 'AC-3'] });
      expect(tasks).toHaveLength(2);
      expect(tasks.find(t => t.id === 'AC-1')).toBeUndefined();
      expect(tasks.find(t => t.id === 'AC-3')).toBeUndefined();
    });

    test('applies limit', async () => {
      const path = createTestBlueprintFile();
      await plugin.initialize({ blueprintPath: path });

      const tasks = await plugin.getTasks({ limit: 2 });
      expect(tasks).toHaveLength(2);
    });

    test('tasks have labels with priority and complexity', async () => {
      const path = createTestBlueprintFile();
      await plugin.initialize({ blueprintPath: path });

      const tasks = await plugin.getTasks();
      expect(tasks[0]!.labels).toContain('P0');
      expect(tasks[0]!.labels).toContain('complexity:feature');
    });
  });

  describe('getTask', () => {
    test('returns a specific task by ID', async () => {
      const path = createTestBlueprintFile();
      await plugin.initialize({ blueprintPath: path });

      const task = await plugin.getTask('AC-2');
      expect(task).toBeDefined();
      expect(task!.id).toBe('AC-2');
      expect(task!.title).toBe('Notes support markdown formatting');
    });

    test('returns undefined for non-existent task', async () => {
      const path = createTestBlueprintFile();
      await plugin.initialize({ blueprintPath: path });

      const task = await plugin.getTask('AC-999');
      expect(task).toBeUndefined();
    });
  });

  describe('completeTask', () => {
    test('marks task as completed', async () => {
      const path = createTestBlueprintFile();
      await plugin.initialize({ blueprintPath: path });

      const result = await plugin.completeTask('AC-1');
      expect(result.success).toBe(true);
      expect(result.message).toContain('AC-1');

      const task = await plugin.getTask('AC-1');
      expect(task!.status).toBe('completed');
    });

    test('returns success even for unknown task ID', async () => {
      const path = createTestBlueprintFile();
      await plugin.initialize({ blueprintPath: path });

      const result = await plugin.completeTask('AC-999');
      expect(result.success).toBe(true);
    });
  });

  describe('isComplete', () => {
    test('returns false when criteria remain unmet', async () => {
      const path = createTestBlueprintFile();
      await plugin.initialize({ blueprintPath: path });

      expect(await plugin.isComplete()).toBe(false);
    });

    test('returns true when all criteria are met', async () => {
      const path = createTestBlueprintFile();
      await plugin.initialize({ blueprintPath: path });

      await plugin.completeTask('AC-1');
      await plugin.completeTask('AC-2');
      await plugin.completeTask('AC-3');
      await plugin.completeTask('AC-4');

      expect(await plugin.isComplete()).toBe(true);
    });

    test('returns true when no blueprint loaded', async () => {
      await plugin.initialize({ blueprintPath: '/nonexistent.md' });
      expect(await plugin.isComplete()).toBe(true);
    });
  });

  describe('isTaskReady', () => {
    test('all tasks are always ready (no dependencies)', async () => {
      const path = createTestBlueprintFile();
      await plugin.initialize({ blueprintPath: path });

      expect(await plugin.isTaskReady('AC-1')).toBe(true);
      expect(await plugin.isTaskReady('AC-4')).toBe(true);
      expect(await plugin.isTaskReady('nonexistent')).toBe(true);
    });
  });

  describe('updateTaskStatus', () => {
    test('updates task status', async () => {
      const path = createTestBlueprintFile();
      await plugin.initialize({ blueprintPath: path });

      // First get tasks to populate internal list
      await plugin.getTasks();

      const updated = await plugin.updateTaskStatus('AC-1', 'in_progress');
      expect(updated).toBeDefined();
      expect(updated!.status).toBe('in_progress');
    });

    test('completing via updateTaskStatus also marks criterion', async () => {
      const path = createTestBlueprintFile();
      await plugin.initialize({ blueprintPath: path });

      await plugin.getTasks();
      await plugin.updateTaskStatus('AC-1', 'completed');

      const task = await plugin.getTask('AC-1');
      expect(task!.status).toBe('completed');
    });
  });

  describe('sync', () => {
    test('reloads blueprint from disk', async () => {
      const path = createTestBlueprintFile();
      await plugin.initialize({ blueprintPath: path });

      const result = await plugin.sync();
      expect(result.success).toBe(true);
      expect(result.message).toContain('Reloaded');
      expect(result.syncedAt).toBeDefined();
    });
  });

  describe('getEpics', () => {
    test('returns empty array (no hierarchy)', async () => {
      const path = createTestBlueprintFile();
      await plugin.initialize({ blueprintPath: path });

      const epics = await plugin.getEpics();
      expect(epics).toEqual([]);
    });
  });

  describe('getPrdContext', () => {
    test('returns blueprint as PRD context', async () => {
      const path = createTestBlueprintFile();
      await plugin.initialize({ blueprintPath: path });

      const context = await plugin.getPrdContext();
      expect(context).not.toBeNull();
      expect(context!.name).toBe('Blueprint');
      expect(context!.description).toContain('collaborative note-taking');
      expect(context!.totalCount).toBe(4);
      expect(context!.completedCount).toBe(0);
    });

    test('returns null when no blueprint loaded', async () => {
      await plugin.initialize({ blueprintPath: '/nonexistent.md' });
      const context = await plugin.getPrdContext();
      expect(context).toBeNull();
    });

    test('tracks completed count', async () => {
      const path = createTestBlueprintFile();
      await plugin.initialize({ blueprintPath: path });

      await plugin.completeTask('AC-1');
      await plugin.completeTask('AC-2');

      const context = await plugin.getPrdContext();
      expect(context!.completedCount).toBe(2);
      expect(context!.totalCount).toBe(4);
    });
  });

  describe('setup questions', () => {
    test('includes blueprintPath question', () => {
      const questions = plugin.getSetupQuestions();
      const bpQuestion = questions.find(q => q.id === 'blueprintPath');
      expect(bpQuestion).toBeDefined();
      expect(bpQuestion?.type).toBe('path');
      expect(bpQuestion?.required).toBe(true);
      expect(bpQuestion?.default).toBe('evolution/blueprint.md');
    });
  });

  describe('validateSetup', () => {
    test('rejects empty blueprint path', async () => {
      const result = await plugin.validateSetup({ blueprintPath: '' });
      expect(result).toContain('required');
    });

    test('accepts valid blueprint path', async () => {
      const result = await plugin.validateSetup({ blueprintPath: 'evolution/blueprint.md' });
      expect(result).toBeNull();
    });
  });

  describe('getTemplate', () => {
    test('returns a non-empty template string', () => {
      const template = plugin.getTemplate();
      expect(template.length).toBeGreaterThan(0);
      expect(template).toContain('Blueprint');
      expect(template).toContain('COMPLETE');
    });
  });

  describe('getStateFiles', () => {
    test('includes blueprint path', async () => {
      const path = createTestBlueprintFile();
      await plugin.initialize({ blueprintPath: path });

      const files = plugin.getStateFiles();
      expect(files).toContain(path);
    });
  });
});
