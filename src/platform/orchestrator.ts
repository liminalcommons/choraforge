/**
 * ABOUTME: App Cell Orchestrator for the Meta-Vibecoding platform.
 * Central coordinator that wires registry, cell manager, agent adapter,
 * and evolution loop into a single lifecycle: register → create cell →
 * assign agent → evolve → monitor → stop.
 * Emits events compatible with EngineEvent for WebSocket forwarding.
 */

import type {
  AgentAdapter,
  AgentAdapterConfig,
  AgentAdapterStatus,
  Blueprint,
  CellRef,
  EvolutionGap,
  EvolutionResult,
} from './agent-adapter.js';
import { createAgentAdapter } from './agent-adapter.js';
import { AppRegistry, type AppStatus } from './registry.js';
import { CellManager, type CellStatus } from './cell-manager.js';
import { analyzeGaps } from './agents/openclaw-adapter.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Combined status for an app: cell health + agent state + evolution progress. */
export interface AppCellStatus {
  appId: string;
  appName: string;
  appStatus: AppStatus;
  cell: CellStatus;
  agent: AgentAdapterStatus;
  evolution: EvolutionProgress;
}

/** Progress of the evolution loop for an app. */
export interface EvolutionProgress {
  /** Total gaps identified from the blueprint */
  totalGaps: number;
  /** Gaps that have been successfully addressed */
  gapsCompleted: number;
  /** Currently being worked on */
  currentGap: string | null;
  /** Whether the evolution loop is active */
  running: boolean;
}

/** Event types emitted by the orchestrator. */
export type OrchestratorEventType =
  | 'app:registered'
  | 'app:cell-created'
  | 'app:agent-assigned'
  | 'app:evolution-started'
  | 'app:evolution-gap-started'
  | 'app:evolution-gap-completed'
  | 'app:evolution-gap-failed'
  | 'app:evolution-completed'
  | 'app:stopping'
  | 'app:stopped'
  | 'app:error';

/** Base event emitted by the orchestrator. */
export interface OrchestratorEvent {
  type: OrchestratorEventType;
  timestamp: string;
  appId: string;
  appName: string;
  detail?: Record<string, unknown>;
}

/** Event listener type. */
export type OrchestratorEventListener = (event: OrchestratorEvent) => void;

/** Options for launching an app. */
export interface LaunchAppOptions {
  /** Blueprint to use for evolution. If not provided, reads from registry's blueprintPath. */
  blueprint?: Blueprint;
  /** Agent adapter config override (otherwise uses registry's agentType). */
  agentConfig?: AgentAdapterConfig;
}

/** Internal state for a running app. */
interface RunningApp {
  appId: string;
  appName: string;
  cellRef: CellRef;
  agent: AgentAdapter;
  blueprint: Blueprint;
  evolution: EvolutionProgress;
  abortController: AbortController;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class AppNotFoundError extends Error {
  constructor(appId: string) {
    super(`App not found in registry: ${appId}`);
    this.name = 'AppNotFoundError';
  }
}

export class AppAlreadyRunningError extends Error {
  constructor(appId: string) {
    super(`App is already running: ${appId}`);
    this.name = 'AppAlreadyRunningError';
  }
}

export class AppNotRunningError extends Error {
  constructor(appId: string) {
    super(`App is not running: ${appId}`);
    this.name = 'AppNotRunningError';
  }
}

export class NoBlueprintError extends Error {
  constructor(appId: string) {
    super(`No blueprint provided and none found in registry for app: ${appId}`);
    this.name = 'NoBlueprintError';
  }
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

/**
 * App Cell Orchestrator — the central coordinator for the Meta-Vibecoding platform.
 *
 * Owns the full lifecycle:
 * 1. Register app → AppRegistry
 * 2. Create cell → CellManager (Docker container)
 * 3. Assign agent → AgentAdapter (OpenClaw or custom)
 * 4. Start evolution → gap analysis loop
 * 5. Monitor → combined status
 * 6. Stop → graceful teardown
 *
 * Multiple apps can run concurrently (each in its own Docker container).
 */
export class AppCellOrchestrator {
  private registry: AppRegistry;
  private cellManager: CellManager;
  private runningApps: Map<string, RunningApp> = new Map();
  private listeners: OrchestratorEventListener[] = [];

  constructor(registry: AppRegistry, cellManager: CellManager) {
    this.registry = registry;
    this.cellManager = cellManager;
  }

  /**
   * Subscribe to orchestrator events.
   * @returns Unsubscribe function.
   */
  on(listener: OrchestratorEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  /**
   * Launch an app: read registry, create/start cell, initialize agent, begin evolution loop.
   *
   * This is the main entry point — "create app + go".
   *
   * @param appId UUID of the registered app
   * @param options Optional blueprint and agent config overrides
   */
  async launchApp(appId: string, options?: LaunchAppOptions): Promise<void> {
    // 1. Validate app exists in registry
    const app = await this.registry.get(appId);
    if (!app) {
      throw new AppNotFoundError(appId);
    }

    // 2. Check not already running
    if (this.runningApps.has(appId)) {
      throw new AppAlreadyRunningError(appId);
    }

    // 3. Resolve blueprint
    const blueprint = options?.blueprint;
    if (!blueprint) {
      throw new NoBlueprintError(appId);
    }

    // 4. Create or reuse cell
    let cellRef = await this.cellManager.getCellRef(app.name);
    if (!cellRef) {
      cellRef = await this.cellManager.createCell({
        appName: app.name,
        repoUrl: app.repoUrl,
        stackType: app.stackType,
      });
      this.emit('app:cell-created', appId, app.name, {
        cellId: cellRef.cellId,
      });
    }

    // 5. Start cell
    await this.cellManager.startCell(app.name);

    // 6. Create agent adapter
    const agentConfig = options?.agentConfig ?? {
      agentType: app.agentType,
      config: {},
      toolPreferences: { primary: 'ralph', fallbacks: [] },
    };
    const agent = createAgentAdapter(agentConfig);
    await agent.initialize(cellRef, blueprint);

    this.emit('app:agent-assigned', appId, app.name, {
      agentType: agentConfig.agentType,
    });

    // 7. Update registry status
    await this.registry.update(appId, { status: 'running' });
    this.emit('app:registered', appId, app.name);

    // 8. Set up evolution state
    const gaps = analyzeGaps(blueprint);
    const evolutionGaps: EvolutionGap[] = gaps.map((g) => ({
      criterionId: g.criterionId,
      description: g.description,
      priority: g.priority,
    }));

    const abortController = new AbortController();

    const runningApp: RunningApp = {
      appId,
      appName: app.name,
      cellRef,
      agent,
      blueprint,
      evolution: {
        totalGaps: evolutionGaps.length,
        gapsCompleted: 0,
        currentGap: null,
        running: true,
      },
      abortController,
    };

    this.runningApps.set(appId, runningApp);

    // 9. Start evolution loop (async, non-blocking)
    this.emit('app:evolution-started', appId, app.name, {
      totalGaps: evolutionGaps.length,
    });

    // Run evolution in background — don't await
    this.runEvolutionLoop(runningApp, evolutionGaps).catch((err) => {
      this.emit('app:error', appId, app.name, {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  /**
   * Stop a running app: stop agent, stop cell, update registry status.
   */
  async stopApp(appId: string): Promise<void> {
    const running = this.runningApps.get(appId);
    if (!running) {
      throw new AppNotRunningError(appId);
    }

    this.emit('app:stopping', appId, running.appName);

    // Signal abort to evolution loop
    running.abortController.abort();
    running.evolution.running = false;

    // Stop agent
    await running.agent.stop();

    // Stop cell
    await this.cellManager.stopCell(running.appName);

    // Update registry
    await this.registry.update(appId, { status: 'idle' });

    // Remove from running
    this.runningApps.delete(appId);

    this.emit('app:stopped', appId, running.appName, {
      gapsCompleted: running.evolution.gapsCompleted,
      totalGaps: running.evolution.totalGaps,
    });
  }

  /**
   * Get combined status for an app: cell health + agent state + evolution progress.
   */
  async getAppStatus(appId: string): Promise<AppCellStatus> {
    const app = await this.registry.get(appId);
    if (!app) {
      throw new AppNotFoundError(appId);
    }

    const cellStatus = await this.cellManager.getCellStatus(app.name);

    const running = this.runningApps.get(appId);
    const agentStatus: AgentAdapterStatus = running
      ? running.agent.status()
      : { state: 'idle' };

    const evolution: EvolutionProgress = running
      ? running.evolution
      : { totalGaps: 0, gapsCompleted: 0, currentGap: null, running: false };

    return {
      appId,
      appName: app.name,
      appStatus: app.status,
      cell: cellStatus,
      agent: agentStatus,
      evolution,
    };
  }

  /**
   * Get all currently running app IDs.
   */
  getRunningApps(): string[] {
    return Array.from(this.runningApps.keys());
  }

  /**
   * Check if an app is currently running.
   */
  isRunning(appId: string): boolean {
    return this.runningApps.has(appId);
  }

  // ─── Internal: Evolution Loop ──────────────────────────────────────────

  /**
   * Run the evolution loop for an app: iterate through gaps, calling agent.evolve() for each.
   * Runs until all gaps are addressed, the agent is stopped, or abort is signaled.
   */
  private async runEvolutionLoop(
    runningApp: RunningApp,
    gaps: EvolutionGap[]
  ): Promise<void> {
    for (const gap of gaps) {
      if (runningApp.abortController.signal.aborted) break;
      if (!runningApp.evolution.running) break;

      runningApp.evolution.currentGap = gap.description;
      this.emit('app:evolution-gap-started', runningApp.appId, runningApp.appName, {
        criterionId: gap.criterionId,
        description: gap.description,
      });

      let result: EvolutionResult;
      try {
        result = await runningApp.agent.evolve(gap);
      } catch (err) {
        this.emit('app:evolution-gap-failed', runningApp.appId, runningApp.appName, {
          criterionId: gap.criterionId,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      if (result.success) {
        runningApp.evolution.gapsCompleted++;
        this.emit('app:evolution-gap-completed', runningApp.appId, runningApp.appName, {
          criterionId: gap.criterionId,
          summary: result.summary,
          filesChanged: result.filesChanged,
          criterionMet: result.criterionMet,
        });
      } else {
        this.emit('app:evolution-gap-failed', runningApp.appId, runningApp.appName, {
          criterionId: gap.criterionId,
          summary: result.summary,
        });
      }
    }

    // Evolution loop complete
    runningApp.evolution.currentGap = null;
    runningApp.evolution.running = false;

    if (!runningApp.abortController.signal.aborted) {
      this.emit('app:evolution-completed', runningApp.appId, runningApp.appName, {
        totalGaps: runningApp.evolution.totalGaps,
        gapsCompleted: runningApp.evolution.gapsCompleted,
      });

      // Update registry status
      await this.registry.update(runningApp.appId, { status: 'idle' });
    }
  }

  // ─── Internal: Events ──────────────────────────────────────────────────

  private emit(
    type: OrchestratorEventType,
    appId: string,
    appName: string,
    detail?: Record<string, unknown>
  ): void {
    const event: OrchestratorEvent = {
      type,
      timestamp: new Date().toISOString(),
      appId,
      appName,
      detail,
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Don't let listener errors break the orchestrator
      }
    }
  }
}
