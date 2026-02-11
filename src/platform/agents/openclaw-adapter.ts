/**
 * ABOUTME: OpenClaw Agent Adapter — the default "product manager" agent.
 * Reads a blueprint, performs gap analysis to build a task queue,
 * then delegates coding tasks to configured tools (Ralph, Claude Code, etc.).
 * Wraps EvolutionEngine internals for gap analysis and scoring.
 */

import type {
  AgentAdapter,
  AgentAdapterConfig,
  AgentAdapterStatus,
  Blueprint,
  CellRef,
  EvolutionGap,
  EvolutionResult,
} from '../agent-adapter.js';
import { registerAgentAdapter } from '../agent-adapter.js';
import type { AgentPlugin, AgentExecuteOptions, AgentExecutionHandle } from '../../plugins/agents/types.js';

// ─── Internal Types ─────────────────────────────────────────────────────────

/** A coding task derived from gap analysis. */
export interface OpenClawTask {
  /** Unique task identifier */
  id: string;
  /** Human-readable task title */
  title: string;
  /** Detailed description of what needs to be done */
  description: string;
  /** Complexity label for routing */
  complexity: 'mechanical' | 'simple' | 'feature' | 'architecture';
  /** Which criterion this task addresses */
  criterionId: string;
  /** Priority (lower = higher priority) */
  priority: number;
  /** Whether this task has been completed */
  completed: boolean;
}

/** A log entry recording an agent decision. */
export interface DecisionLogEntry {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Type of decision */
  type: 'gap_analysis' | 'task_delegated' | 'task_completed' | 'task_failed' | 'blueprint_updated' | 'stopped';
  /** Human-readable description */
  description: string;
  /** Related criterion ID, if any */
  criterionId?: string;
  /** Related task ID, if any */
  taskId?: string;
}

/** Configuration specific to OpenClaw agent. */
export interface OpenClawConfig {
  /** Agent plugin instance to use as the coding tool */
  codingTool?: AgentPlugin;
  /** Factory function to resolve a coding tool by name */
  resolveTool?: (toolName: string) => AgentPlugin | undefined;
  /** Maximum tasks to generate per gap analysis pass */
  maxTasksPerAnalysis?: number;
  /** Timeout for coding tool execution in ms */
  toolTimeout?: number;
}

// ─── Gap Analysis ───────────────────────────────────────────────────────────

/**
 * Perform gap analysis on a blueprint — find unmet criteria and generate tasks.
 * This extracts the core logic from EvolutionEngine.runGapAnalysis() into a
 * pure function that OpenClaw can call without instantiating the full engine.
 */
export function analyzeGaps(blueprint: Blueprint, maxTasks?: number): OpenClawTask[] {
  const unmet = blueprint.criteria.filter((c) => !c.met);
  if (unmet.length === 0) return [];

  // Sort by priority (lower = higher priority)
  const sorted = [...unmet].sort((a, b) => a.priority - b.priority);

  // Limit to maxTasks if specified
  const candidates = maxTasks ? sorted.slice(0, maxTasks) : sorted;

  return candidates.map((criterion, index) => ({
    id: `OC-${index + 1}`,
    title: `Implement: ${criterion.description.slice(0, 80)}`,
    description: criterion.description,
    complexity: inferComplexity(criterion.description),
    criterionId: criterion.id,
    priority: criterion.priority,
    completed: false,
  }));
}

/**
 * Infer task complexity from the criterion description.
 * Simple heuristic — the EvolutionEngine uses the architect agent for this,
 * but OpenClaw does a lightweight version locally.
 */
function inferComplexity(description: string): OpenClawTask['complexity'] {
  const lower = description.toLowerCase();
  if (lower.includes('schema') || lower.includes('architect') || lower.includes('design') || lower.includes('refactor')) {
    return 'architecture';
  }
  if (lower.includes('fix') || lower.includes('type') || lower.includes('lint') || lower.includes('import')) {
    return 'mechanical';
  }
  if (lower.includes('add') || lower.includes('implement') || lower.includes('create') || lower.includes('build')) {
    return 'feature';
  }
  return 'simple';
}

/**
 * Build a coding prompt for a task, suitable for delegation to Ralph or Claude Code.
 */
export function buildTaskPrompt(task: OpenClawTask, blueprint: Blueprint, cell: CellRef): string {
  return `You are working in a ${cell.stackType} project at ${cell.workDir}.

## Task: ${task.title}

${task.description}

## Context
This task addresses acceptance criterion: ${task.criterionId}
Project vision: ${blueprint.vision}

## Constraints
${blueprint.constraints.map((c) => `- ${c}`).join('\n')}

## Instructions
1. Read the relevant code to understand the current state
2. Make the minimal changes needed to satisfy this criterion
3. Ensure the code compiles/passes type checks
4. When complete, output: <promise>COMPLETE</promise>`;
}

// ─── OpenClawAdapter ────────────────────────────────────────────────────────

/**
 * OpenClaw Agent Adapter — the default product manager agent for Meta-Vibecoding.
 *
 * OpenClaw decides WHAT to build (product decisions based on blueprint gap analysis)
 * and delegates HOW to build it to coding tools (Ralph CLI, Claude Code CLI, etc.).
 */
export class OpenClawAdapter implements AgentAdapter {
  private config: AgentAdapterConfig;
  private openClawConfig: OpenClawConfig;
  private cell: CellRef | null = null;
  private blueprint: Blueprint | null = null;
  private taskQueue: OpenClawTask[] = [];
  private currentHandle: AgentExecutionHandle | null = null;
  private decisionsLog: DecisionLogEntry[] = [];
  private _status: AgentAdapterStatus = { state: 'idle' };
  private _stopped = false;

  constructor(adapterConfig: AgentAdapterConfig, openClawConfig: OpenClawConfig = {}) {
    this.config = adapterConfig;
    this.openClawConfig = openClawConfig;
  }

  // ─── AgentAdapter Interface ─────────────────────────────────────────────

  async initialize(cell: CellRef, blueprint: Blueprint): Promise<void> {
    this.cell = cell;
    this.blueprint = blueprint;
    this._stopped = false;
    this._status = { state: 'idle' };

    // Run initial gap analysis to populate task queue
    this.taskQueue = analyzeGaps(blueprint, this.openClawConfig.maxTasksPerAnalysis);

    this.logDecision({
      type: 'gap_analysis',
      description: `Initial gap analysis: ${this.taskQueue.length} tasks from ${blueprint.criteria.filter((c) => !c.met).length} unmet criteria`,
    });
  }

  async evolve(gap: EvolutionGap): Promise<EvolutionResult> {
    if (this._stopped) {
      return {
        success: false,
        criterionId: gap.criterionId,
        summary: 'Agent is stopped',
        filesChanged: [],
        criterionMet: false,
      };
    }

    // Find the task for this gap, or create one
    let task = this.taskQueue.find((t) => t.criterionId === gap.criterionId && !t.completed);
    if (!task) {
      task = {
        id: `OC-adhoc-${Date.now()}`,
        title: `Address gap: ${gap.description.slice(0, 80)}`,
        description: gap.description,
        complexity: inferComplexity(gap.description),
        criterionId: gap.criterionId,
        priority: gap.priority,
        completed: false,
      };
      this.taskQueue.push(task);
    }

    this._status = {
      state: 'evolving',
      currentTask: task.title,
      criterionId: gap.criterionId,
    };

    this.logDecision({
      type: 'task_delegated',
      description: `Delegating "${task.title}" to tool: ${this.config.toolPreferences.primary}`,
      criterionId: gap.criterionId,
      taskId: task.id,
    });

    // Delegate to coding tool
    const result = await this.delegateToTool(task);

    this.currentHandle = null;

    if (result.success) {
      task.completed = true;
      this.logDecision({
        type: 'task_completed',
        description: `Task "${task.title}" completed: ${result.summary}`,
        criterionId: gap.criterionId,
        taskId: task.id,
      });
    } else {
      this.logDecision({
        type: 'task_failed',
        description: `Task "${task.title}" failed: ${result.summary}`,
        criterionId: gap.criterionId,
        taskId: task.id,
      });
    }

    if (!this._stopped) {
      this._status = { state: 'idle' };
    }

    return result;
  }

  status(): AgentAdapterStatus {
    return this._status;
  }

  async stop(): Promise<void> {
    this._stopped = true;

    // Interrupt current tool execution if running
    if (this.currentHandle && this.currentHandle.isRunning()) {
      this.currentHandle.interrupt();
    }

    this._status = { state: 'stopped', reason: 'User requested stop' };
    this.currentHandle = null;

    this.logDecision({
      type: 'stopped',
      description: 'Agent stopped by user request',
    });
  }

  async onBlueprintUpdate(blueprint: Blueprint): Promise<void> {
    this.blueprint = blueprint;

    // Re-run gap analysis with the updated blueprint
    const newTasks = analyzeGaps(blueprint, this.openClawConfig.maxTasksPerAnalysis);

    // Preserve completed tasks, replace pending ones
    const completedIds = new Set(this.taskQueue.filter((t) => t.completed).map((t) => t.criterionId));
    this.taskQueue = [
      ...this.taskQueue.filter((t) => t.completed),
      ...newTasks.filter((t) => !completedIds.has(t.criterionId)),
    ];

    this.logDecision({
      type: 'blueprint_updated',
      description: `Blueprint updated. Queue: ${this.taskQueue.filter((t) => !t.completed).length} pending, ${this.taskQueue.filter((t) => t.completed).length} completed`,
    });
  }

  // ─── OpenClaw-specific Accessors ────────────────────────────────────────

  /** Get the current task queue. */
  getTaskQueue(): readonly OpenClawTask[] {
    return this.taskQueue;
  }

  /** Get the decisions log. */
  getDecisionsLog(): readonly DecisionLogEntry[] {
    return this.decisionsLog;
  }

  /** Get the current blueprint. */
  getBlueprint(): Blueprint | null {
    return this.blueprint;
  }

  // ─── Internal Methods ───────────────────────────────────────────────────

  /**
   * Delegate a coding task to the configured tool (Ralph, Claude Code, etc.).
   * Returns an EvolutionResult based on the tool's output.
   */
  private async delegateToTool(task: OpenClawTask): Promise<EvolutionResult> {
    const tool = this.resolveCodingTool();

    if (!tool) {
      return {
        success: false,
        criterionId: task.criterionId,
        summary: `No coding tool available (tried: ${this.config.toolPreferences.primary})`,
        filesChanged: [],
        criterionMet: false,
      };
    }

    const prompt = buildTaskPrompt(task, this.blueprint!, this.cell!);
    let output = '';

    const options: AgentExecuteOptions = {
      cwd: this.cell!.workDir,
      timeout: this.openClawConfig.toolTimeout ?? 300_000, // 5 min default
      onStdout: (data: string) => {
        output += data;
      },
    };

    try {
      const handle = tool.execute(prompt, undefined, options);
      this.currentHandle = handle;

      const result = await handle.promise;
      const fullOutput = output || result.stdout;

      if (this._stopped) {
        return {
          success: false,
          criterionId: task.criterionId,
          summary: 'Interrupted by stop request',
          filesChanged: [],
          criterionMet: false,
        };
      }

      const success = result.status === 'completed' && result.exitCode === 0;
      const filesChanged = extractChangedFiles(fullOutput);
      const criterionMet = fullOutput.includes('<promise>COMPLETE</promise>') || success;

      return {
        success,
        criterionId: task.criterionId,
        summary: success
          ? `Tool completed task "${task.title}"`
          : `Tool failed: ${result.error ?? `exit code ${result.exitCode}`}`,
        filesChanged,
        criterionMet,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        criterionId: task.criterionId,
        summary: `Tool execution error: ${message}`,
        filesChanged: [],
        criterionMet: false,
      };
    }
  }

  /**
   * Resolve the coding tool to use for delegation.
   * Tries primary tool first, then fallbacks.
   */
  private resolveCodingTool(): AgentPlugin | undefined {
    // Direct injection takes priority (for testing and simple configs)
    if (this.openClawConfig.codingTool) {
      return this.openClawConfig.codingTool;
    }

    // Use resolver function if provided
    if (this.openClawConfig.resolveTool) {
      const primary = this.openClawConfig.resolveTool(this.config.toolPreferences.primary);
      if (primary) return primary;

      for (const fallback of this.config.toolPreferences.fallbacks) {
        const tool = this.openClawConfig.resolveTool(fallback);
        if (tool) return tool;
      }
    }

    return undefined;
  }

  /** Add an entry to the decisions log. */
  private logDecision(entry: Omit<DecisionLogEntry, 'timestamp'>): void {
    this.decisionsLog.push({
      timestamp: new Date().toISOString(),
      ...entry,
    });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract file paths from tool output.
 * Looks for common patterns like `Modified: path/to/file` or diff headers.
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

// ─── Factory Registration ───────────────────────────────────────────────────

/**
 * Create an OpenClawAdapter from adapter config.
 * The OpenClawConfig must be passed via the config record.
 */
export function createOpenClawAdapter(config: AgentAdapterConfig): OpenClawAdapter {
  const openClawConfig: OpenClawConfig = {
    maxTasksPerAnalysis: (config.config.maxTasksPerAnalysis as number) ?? undefined,
    toolTimeout: (config.config.toolTimeout as number) ?? undefined,
  };

  return new OpenClawAdapter(config, openClawConfig);
}

/**
 * Register the OpenClaw adapter with the adapter factory.
 * Call this during platform initialization.
 */
export function registerOpenClawAdapter(): void {
  registerAgentAdapter('openclaw', createOpenClawAdapter);
}
