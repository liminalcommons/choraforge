/**
 * ABOUTME: Evolution tracker plugin for ChoraForge.
 * Reads evolution/blueprint.md and generates tasks dynamically from
 * gap analysis. Tracks which acceptance criteria are met across versions.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type {
  TrackerPluginMeta,
  TrackerPluginFactory,
  TrackerTask,
  TaskFilter,
  TrackerTaskStatus,
  TaskCompletionResult,
  SyncResult,
  SetupQuestion,
} from '../../types.js';
import { BaseTrackerPlugin } from '../../base.js';
import { loadBlueprint, serializeBlueprint, type Blueprint } from '../../../../commands/blueprint.js';

/**
 * Evolution tracker plugin that works with blueprint-driven gap analysis.
 *
 * Unlike beads or json trackers that have pre-defined task lists,
 * the evolution tracker generates tasks dynamically from gap analysis
 * of the blueprint acceptance criteria.
 */
export class EvolutionTrackerPlugin extends BaseTrackerPlugin {
  readonly meta: TrackerPluginMeta = {
    id: 'evolution',
    name: 'Evolution Tracker',
    description: 'Blueprint-driven evolutionary task tracker for ChoraForge',
    version: '1.0.0',
    author: 'ChoraForge',
    supportsBidirectionalSync: false,
    supportsHierarchy: false,
    supportsDependencies: false,
  };

  private blueprint: Blueprint | null = null;
  private blueprintPath = '';
  private tasks: TrackerTask[] = [];
  private completedTaskIds: Set<string> = new Set();

  override async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize(config);

    // Get blueprint path from config or default
    this.blueprintPath = typeof config.blueprintPath === 'string'
      ? config.blueprintPath
      : join(process.cwd(), 'evolution', 'blueprint.md');

    // Load blueprint
    this.blueprint = loadBlueprint(this.blueprintPath);
    if (!this.blueprint) {
      this.ready = false;
    }
  }

  override async isReady(): Promise<boolean> {
    return this.ready && this.blueprint !== null;
  }

  /**
   * Generate tasks from unmet blueprint criteria.
   * Each unmet criterion becomes a task.
   */
  async getTasks(filter?: TaskFilter): Promise<TrackerTask[]> {
    if (!this.blueprint) return [];

    // Generate tasks from unmet criteria
    this.tasks = this.blueprint.criteria.map((criterion, _index) => {
      const isCompleted = criterion.met || this.completedTaskIds.has(criterion.id);
      const status: TrackerTaskStatus = isCompleted ? 'completed' : 'open';

      return {
        id: criterion.id,
        title: criterion.description,
        status,
        priority: criterion.priority === 'P0' ? 0 : criterion.priority === 'P1' ? 1 : 2,
        description: criterion.description,
        labels: [criterion.priority, `complexity:feature`],
        type: 'feature',
        metadata: {
          criterionId: criterion.id,
          priority: criterion.priority,
          met: criterion.met,
        },
      };
    });

    // Apply filter
    if (filter) {
      let filtered = [...this.tasks];

      if (filter.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        filtered = filtered.filter(t => statuses.includes(t.status));
      }

      if (filter.excludeIds) {
        filtered = filtered.filter(t => !filter.excludeIds!.includes(t.id));
      }

      if (filter.limit) {
        filtered = filtered.slice(0, filter.limit);
      }

      return filtered;
    }

    return this.tasks;
  }

  async getTask(id: string): Promise<TrackerTask | undefined> {
    const tasks = await this.getTasks();
    return tasks.find(t => t.id === id);
  }

  async completeTask(id: string, _reason?: string): Promise<TaskCompletionResult> {
    this.completedTaskIds.add(id);

    // Update criterion in blueprint
    if (this.blueprint) {
      const criterion = this.blueprint.criteria.find(c => c.id === id);
      if (criterion) {
        criterion.met = true;
        this.blueprint.metadata.lastModified = new Date().toISOString();
        this.blueprint.metadata.version++;
      }
    }

    const task = await this.getTask(id);
    return {
      success: true,
      message: `Completed task ${id}`,
      task,
    };
  }

  async updateTaskStatus(id: string, status: TrackerTaskStatus): Promise<TrackerTask | undefined> {
    if (status === 'completed') {
      await this.completeTask(id);
    }
    // Other status changes are tracked in the in-memory task list
    const task = this.tasks.find(t => t.id === id);
    if (task) {
      task.status = status;
    }
    return task;
  }

  async isComplete(_filter?: TaskFilter): Promise<boolean> {
    if (!this.blueprint) return true;
    return this.blueprint.criteria.every(c => c.met || this.completedTaskIds.has(c.id));
  }

  async isTaskReady(_id: string): Promise<boolean> {
    // Evolution tasks have no dependencies (they're all independent criteria)
    return true;
  }

  async sync(): Promise<SyncResult> {
    // Reload blueprint from disk
    this.blueprint = loadBlueprint(this.blueprintPath);
    return {
      success: true,
      message: 'Reloaded blueprint from disk',
      syncedAt: new Date().toISOString(),
    };
  }

  async getEpics(): Promise<TrackerTask[]> {
    // No hierarchical structure in evolution mode
    return [];
  }

  /**
   * Return the PRD context for prompt rendering.
   * Uses the blueprint as the PRD.
   */
  async getPrdContext(): Promise<{
    name: string;
    description?: string;
    content: string;
    completedCount: number;
    totalCount: number;
  } | null> {
    if (!this.blueprint) return null;

    const content = serializeBlueprint(this.blueprint);
    const totalCriteria = this.blueprint.criteria.length;
    const metCriteria = this.blueprint.criteria.filter(c => c.met).length;

    return {
      name: 'Blueprint',
      description: this.blueprint.vision,
      content,
      completedCount: metCriteria,
      totalCount: totalCriteria,
    };
  }

  getSetupQuestions(): SetupQuestion[] {
    return [
      {
        id: 'blueprintPath',
        prompt: 'Path to blueprint file:',
        type: 'path',
        default: 'evolution/blueprint.md',
        required: true,
        help: 'Path to the evolution blueprint markdown file',
      },
    ];
  }

  async validateSetup(answers: Record<string, unknown>): Promise<string | null> {
    const path = typeof answers.blueprintPath === 'string' ? answers.blueprintPath : '';
    if (!path) {
      return 'Blueprint path is required';
    }
    return null;
  }

  /**
   * Return the Handlebars template for evolution prompts.
   */
  getTemplate(): string {
    // Load template from file if it exists, otherwise use inline default
    const templatePath = join(dirname(new URL(import.meta.url).pathname), 'template.hbs');
    try {
      if (existsSync(templatePath)) {
        return readFileSync(templatePath, 'utf-8');
      }
    } catch {
      // Fall through to inline template
    }

    return EVOLUTION_TEMPLATE;
  }

  /**
   * Get files that should be preserved during git merges.
   */
  getStateFiles(): string[] {
    return [this.blueprintPath];
  }
}

/**
 * Inline template for evolution mode prompts.
 */
const EVOLUTION_TEMPLATE = `## Blueprint Context

{{#if prdContent}}
{{{prdContent}}}
{{/if}}

## Current Task

**ID**: {{taskId}}
**Title**: {{taskTitle}}
{{#if taskDescription}}
**Description**: {{{taskDescription}}}
{{/if}}

## Instructions

You are implementing a specific acceptance criterion from the project blueprint.

1. Study the blueprint above to understand the overall project vision
2. Read the codebase to understand the current state
3. Implement the changes needed to satisfy this acceptance criterion
4. Run any relevant tests or type checks
5. Verify the implementation meets the criterion description

{{#if recentProgress}}
## Recent Progress

{{{recentProgress}}}
{{/if}}

## Completion

When you have fully implemented the criterion:
1. Append learnings to \`.ralph-tui/progress.md\`
2. Signal completion with: <promise>COMPLETE</promise>
`;

/**
 * Factory function for the Evolution tracker plugin.
 */
const createEvolutionTracker: TrackerPluginFactory = () => new EvolutionTrackerPlugin();

export default createEvolutionTracker;
