/**
 * ABOUTME: Ralph Tool Adapter for the Meta-Vibecoding platform.
 * Wraps the existing ExecutionEngine for use as a coding TOOL within an agent.
 * Agents decide WHAT to build; this adapter handles HOW by running Ralph's execution loop.
 * Accepts a task description + acceptance criteria, runs the engine, returns structured results.
 */

import { ExecutionEngine } from '../../engine/index.js';
import type { RalphConfig } from '../../config/types.js';
import type { AgentPluginConfig } from '../../plugins/agents/types.js';
import type {
  TrackerPlugin,
  TrackerTask,
  TrackerPluginConfig,
  TrackerTaskStatus,
  TaskFilter,
  TaskCompletionResult,
  SyncResult,
  SetupQuestion,
} from '../../plugins/trackers/types.js';
import type { CellRef } from '../agent-adapter.js';
import type { EngineEvent } from '../../engine/types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Input for running a coding task through Ralph. */
export interface RalphToolInput {
  /** Human-readable task description */
  description: string;
  /** Acceptance criteria the task must meet */
  acceptanceCriteria: string[];
  /** Optional task ID (auto-generated if not provided) */
  taskId?: string;
}

/** Structured result from a Ralph tool execution. */
export interface RalphToolResult {
  /** Whether the task was completed successfully */
  success: boolean;
  /** Files that were changed during execution */
  filesChanged: string[];
  /** Whether tests passed (null if no test signal detected) */
  testsPassed: boolean | null;
  /** Combined output log from the agent */
  outputLog: string;
  /** Error message if execution failed */
  error?: string;
  /** Duration of execution in milliseconds */
  durationMs: number;
}

/** Configuration for the Ralph Tool Adapter. */
export interface RalphToolAdapterConfig {
  /** Agent plugin to use for coding (e.g., 'claude', 'opencode') */
  agentPlugin: string;
  /** Optional agent-specific options */
  agentOptions?: Record<string, unknown>;
  /** Optional model override for the agent */
  model?: string;
  /** Maximum iterations per task (default: 3) */
  maxIterations?: number;
  /** Timeout per execution in milliseconds (default: 300000 = 5 min) */
  timeout?: number;
}

// ─── In-Memory Tracker ───────────────────────────────────────────────────────

/**
 * Minimal in-memory tracker that serves a single task.
 * The ExecutionEngine requires a TrackerPlugin; this implementation
 * holds one task and tracks its status without external I/O.
 */
class SingleTaskTracker implements TrackerPlugin {
  readonly meta = {
    id: 'single-task',
    name: 'Single Task Tracker',
    description: 'In-memory tracker for a single task',
    version: '1.0.0',
    supportsBidirectionalSync: false,
    supportsHierarchy: false,
    supportsDependencies: false,
  };

  private task: TrackerTask;
  private completed = false;

  constructor(task: TrackerTask) {
    this.task = { ...task };
  }

  async initialize(): Promise<void> {}
  async sync(): Promise<SyncResult> { return { success: true, message: 'No-op', syncedAt: new Date().toISOString() }; }
  async isReady(): Promise<boolean> { return true; }
  async dispose(): Promise<void> {}

  async isComplete(_filter?: TaskFilter): Promise<boolean> {
    return this.completed;
  }

  async getTasks(filter?: TaskFilter): Promise<TrackerTask[]> {
    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      if (!statuses.includes(this.task.status)) {
        return [];
      }
    }
    if (filter?.excludeIds?.includes(this.task.id)) {
      return [];
    }
    return [this.task];
  }

  async getTask(id: string): Promise<TrackerTask | undefined> {
    return id === this.task.id ? this.task : undefined;
  }

  async getNextTask(filter?: TaskFilter): Promise<TrackerTask | undefined> {
    if (this.completed || this.task.status === 'completed') {
      return undefined;
    }
    if (filter?.excludeIds?.includes(this.task.id)) {
      return undefined;
    }
    return this.task;
  }

  async updateTaskStatus(taskId: string, status: TrackerTaskStatus): Promise<TrackerTask | undefined> {
    if (taskId === this.task.id) {
      this.task.status = status;
      return this.task;
    }
    return undefined;
  }

  async completeTask(taskId: string, _reason?: string): Promise<TaskCompletionResult> {
    if (taskId === this.task.id) {
      this.task.status = 'completed';
      this.completed = true;
      return { success: true, message: 'Task completed', task: this.task };
    }
    return { success: false, message: `Task not found: ${taskId}` };
  }

  async isTaskReady(id: string): Promise<boolean> {
    return id === this.task.id && !this.completed;
  }

  async getEpics(): Promise<TrackerTask[]> {
    return [];
  }

  getSetupQuestions(): SetupQuestion[] {
    return [];
  }

  async validateSetup(): Promise<string | null> {
    return null;
  }

  getTemplate(): string {
    return '';
  }

  async getPrdContext(): Promise<null> {
    return null;
  }
}

// ─── RalphToolAdapter ────────────────────────────────────────────────────────

/**
 * Ralph Tool Adapter — wraps ExecutionEngine for use as a coding tool.
 *
 * This is the HOW side of the agent/tool split:
 * - Agent (OpenClaw) decides WHAT to build
 * - Tool (RalphToolAdapter) handles HOW by running the execution engine
 *
 * Usage:
 * ```ts
 * const adapter = new RalphToolAdapter(cell, config);
 * const result = await adapter.run({
 *   description: 'Add a landing page',
 *   acceptanceCriteria: ['Page has a hero section', 'Responsive CSS'],
 * });
 * ```
 */
export class RalphToolAdapter {
  private cell: CellRef;
  private config: RalphToolAdapterConfig;
  private engine: ExecutionEngine | null = null;
  private running = false;

  constructor(cell: CellRef, config: RalphToolAdapterConfig) {
    this.cell = cell;
    this.config = config;
  }

  /**
   * Run a coding task through the Ralph execution engine.
   * Creates an in-memory tracker with the task, initializes the engine,
   * runs the iteration loop, and returns structured results.
   */
  async run(input: RalphToolInput): Promise<RalphToolResult> {
    if (this.running) {
      return {
        success: false,
        filesChanged: [],
        testsPassed: null,
        outputLog: '',
        error: 'Adapter is already running a task',
        durationMs: 0,
      };
    }

    this.running = true;
    const startTime = Date.now();
    let outputLog = '';
    let stderrLog = '';

    try {
      // Build a TrackerTask from the input
      const taskId = input.taskId ?? `ralph-tool-${Date.now()}`;
      const task: TrackerTask = {
        id: taskId,
        title: input.description.slice(0, 120),
        status: 'open',
        priority: 1,
        description: this.buildTaskDescription(input),
      };

      // Create the in-memory tracker
      const tracker = new SingleTaskTracker(task);

      // Build a RalphConfig scoped to the cell's working directory
      const ralphConfig = this.buildRalphConfig();

      // Create and initialize the engine in worker mode
      this.engine = new ExecutionEngine(ralphConfig);
      await this.engine.initialize({
        tracker,
        forcedTask: task,
      });

      // Collect output via events
      const removeListener = this.engine.on((event: EngineEvent) => {
        if (event.type === 'agent:output') {
          if (event.stream === 'stdout') {
            outputLog += event.data;
          } else {
            stderrLog += event.data;
          }
        }
      });

      // Run the engine (will stop after the single task completes or max iterations)
      await this.engine.start();
      removeListener();

      const durationMs = Date.now() - startTime;
      const state = this.engine.getState();
      const success = state.tasksCompleted > 0;
      const filesChanged = extractChangedFiles(outputLog);
      const testsPassed = detectTestResults(outputLog);

      return {
        success,
        filesChanged,
        testsPassed,
        outputLog: outputLog + (stderrLog ? `\n--- stderr ---\n${stderrLog}` : ''),
        durationMs,
        error: success ? undefined : 'Task did not complete within allowed iterations',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        filesChanged: [],
        testsPassed: null,
        outputLog: outputLog + (stderrLog ? `\n--- stderr ---\n${stderrLog}` : ''),
        error: message,
        durationMs: Date.now() - startTime,
      };
    } finally {
      this.running = false;
      this.engine = null;
    }
  }

  /**
   * Stop the currently running task, if any.
   */
  async stop(): Promise<void> {
    if (this.engine && this.running) {
      await this.engine.stop();
    }
  }

  /**
   * Check if the adapter is currently running a task.
   */
  isRunning(): boolean {
    return this.running;
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  /**
   * Build a full task description from input, including acceptance criteria.
   */
  private buildTaskDescription(input: RalphToolInput): string {
    const lines: string[] = [input.description];

    if (input.acceptanceCriteria.length > 0) {
      lines.push('');
      lines.push('## Acceptance Criteria');
      for (const criterion of input.acceptanceCriteria) {
        lines.push(`- [ ] ${criterion}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Build a RalphConfig for the ExecutionEngine.
   * Uses the cell's working directory and a minimal configuration.
   */
  private buildRalphConfig(): RalphConfig {
    const agentConfig: AgentPluginConfig = {
      name: this.config.agentPlugin,
      plugin: this.config.agentPlugin,
      options: this.config.agentOptions ?? {},
    };

    const trackerConfig: TrackerPluginConfig = {
      name: 'single-task',
      plugin: 'single-task',
      options: {},
    };

    return {
      agent: agentConfig,
      tracker: trackerConfig,
      maxIterations: this.config.maxIterations ?? 3,
      iterationDelay: 0,
      cwd: this.cell.workDir,
      outputDir: '.ralph-tui/iterations',
      progressFile: '.ralph-tui/progress.md',
      showTui: false,
      model: this.config.model,
      errorHandling: {
        strategy: 'skip',
        maxRetries: 1,
        retryDelayMs: 1000,
        continueOnNonZeroExit: false,
      },
    };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract file paths from agent output.
 * Looks for common patterns: diff headers, Modified/Created lines.
 */
function extractChangedFiles(output: string): string[] {
  const files = new Set<string>();

  // Match diff headers: --- a/file or +++ b/file
  for (const match of output.matchAll(/^[+-]{3} [ab]\/(.+)$/gm)) {
    if (match[1]) files.add(match[1]);
  }

  // Match "Modified: file" or "Created: file" patterns
  for (const match of output.matchAll(/^(?:Modified|Created|Changed|Updated|Added):\s*(.+)$/gm)) {
    if (match[1]) files.add(match[1].trim());
  }

  return Array.from(files);
}

/**
 * Detect test pass/fail signals from agent output.
 * Returns true if tests passed, false if failed, null if no test signal found.
 */
function detectTestResults(output: string): boolean | null {
  // Common test result patterns
  if (/tests?\s+passed/i.test(output) || /all\s+tests?\s+pass/i.test(output)) {
    return true;
  }
  if (/tests?\s+failed/i.test(output) || /test\s+failure/i.test(output)) {
    return false;
  }
  // Bun/Jest/Vitest specific
  if (/\d+\s+pass(?:ed)?[,\s]+0\s+fail/i.test(output)) {
    return true;
  }
  if (/\d+\s+fail(?:ed)?/i.test(output)) {
    return false;
  }
  return null;
}
