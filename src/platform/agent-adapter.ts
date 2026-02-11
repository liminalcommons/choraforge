/**
 * ABOUTME: Agent Adapter interface for the Meta-Vibecoding platform.
 * Defines the contract between the platform and any agent implementation.
 * Agents decide WHAT to build (product decisions); tools decide HOW (code changes).
 * Designed for 5 methods max — kept minimal and pluggable.
 */

import { z } from 'zod';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Reference to an execution cell (Docker container) that the agent operates within.
 * Kept minimal — the agent doesn't need to manage the cell, just know where it is.
 */
export interface CellRef {
  /** Unique cell/container identifier */
  cellId: string;
  /** Absolute path to the app's working directory inside the cell */
  workDir: string;
  /** Stack type of the cell */
  stackType: 'node' | 'python' | 'rust';
}

/**
 * Structured blueprint that guides the agent's evolution decisions.
 */
export interface Blueprint {
  /** Human-readable vision statement */
  vision: string;
  /** Acceptance criteria the app must meet */
  criteria: BlueprintCriterion[];
  /** Constraints the agent must respect */
  constraints: string[];
  /** Explicitly out-of-scope items */
  outOfScope: string[];
}

/**
 * A single acceptance criterion within a blueprint.
 */
export interface BlueprintCriterion {
  /** Unique identifier for this criterion */
  id: string;
  /** Description of what must be true */
  description: string;
  /** Whether this criterion is currently met */
  met: boolean;
  /** Priority (lower = higher priority) */
  priority: number;
}

/**
 * A gap between the current app state and the blueprint's acceptance criteria.
 * Produced by gap analysis, consumed by the agent's evolve() method.
 */
export interface EvolutionGap {
  /** The unmet criterion this gap addresses */
  criterionId: string;
  /** Human-readable description of what's missing */
  description: string;
  /** Suggested priority (lower = more urgent) */
  priority: number;
}

/**
 * Status of the agent's current activity.
 */
export type AgentAdapterStatus =
  | { state: 'idle' }
  | { state: 'evolving'; currentTask: string; criterionId: string }
  | { state: 'stopped'; reason: string }
  | { state: 'error'; error: string };

/**
 * Result of an evolution step.
 */
export interface EvolutionResult {
  /** Whether the evolution step succeeded */
  success: boolean;
  /** Which criterion was addressed */
  criterionId: string;
  /** Human-readable summary of what was done */
  summary: string;
  /** Files that were changed */
  filesChanged: string[];
  /** Whether the targeted criterion is now met */
  criterionMet: boolean;
}

// ─── Config Schema ───────────────────────────────────────────────────────────

/**
 * Zod schema for agent adapter configuration.
 */
export const AgentAdapterConfigSchema = z.object({
  /** Which agent type to use (e.g., 'openclaw', 'manual') */
  agentType: z.string().min(1),
  /** Agent-specific configuration */
  config: z.record(z.string(), z.unknown()).default({}),
  /** Which coding tools the agent prefers to delegate to */
  toolPreferences: z.object({
    /** Primary tool for code changes (e.g., 'ralph', 'claude-code', 'cursor') */
    primary: z.string().min(1),
    /** Fallback tools in priority order */
    fallbacks: z.array(z.string().min(1)).default([]),
  }),
});

export type AgentAdapterConfig = z.infer<typeof AgentAdapterConfigSchema>;

// ─── Interface ───────────────────────────────────────────────────────────────

/**
 * The Agent Adapter interface — the contract any agent must implement.
 *
 * An agent is a "product manager" for an app: it decides WHAT to build next
 * based on the blueprint, then delegates the HOW to coding tools (Ralph, Claude Code, etc.).
 *
 * 5 methods, no more:
 * 1. initialize  — Set up the agent with its cell and blueprint
 * 2. evolve      — Address a specific gap (the core loop)
 * 3. status      — Report current state
 * 4. stop        — Gracefully shut down
 * 5. onBlueprintUpdate — React to blueprint changes mid-evolution
 */
export interface AgentAdapter {
  /**
   * Initialize the agent with its execution cell and blueprint.
   * Called once when the agent is assigned to an app.
   *
   * @param cell Reference to the Docker cell the agent operates within
   * @param blueprint The app's evolution blueprint
   */
  initialize(cell: CellRef, blueprint: Blueprint): Promise<void>;

  /**
   * Evolve the app by addressing a specific gap.
   * The agent decides how to approach it, then delegates coding to tools.
   *
   * @param gap The gap between current state and blueprint criteria
   * @returns Result of the evolution step
   */
  evolve(gap: EvolutionGap): Promise<EvolutionResult>;

  /**
   * Report the agent's current status.
   */
  status(): AgentAdapterStatus;

  /**
   * Gracefully stop the agent.
   * Should interrupt any in-progress tool executions and clean up resources.
   */
  stop(): Promise<void>;

  /**
   * React to a blueprint update mid-evolution.
   * Called when a human edits the blueprint while the agent is running.
   * The agent should re-evaluate its priorities based on the new blueprint.
   *
   * @param blueprint The updated blueprint
   */
  onBlueprintUpdate(blueprint: Blueprint): Promise<void>;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/** Factory function type that creates an AgentAdapter from config. */
export type AgentAdapterFactoryFn = (config: AgentAdapterConfig) => AgentAdapter;

/** Registry of agent adapter factories, keyed by agentType. */
const adapterFactories = new Map<string, AgentAdapterFactoryFn>();

/**
 * Register an agent adapter factory for a given agent type.
 *
 * @param agentType The agent type string (e.g., 'openclaw')
 * @param factory Function that creates an AgentAdapter from config
 */
export function registerAgentAdapter(agentType: string, factory: AgentAdapterFactoryFn): void {
  if (adapterFactories.has(agentType)) {
    throw new Error(`Agent adapter already registered for type: ${agentType}`);
  }
  adapterFactories.set(agentType, factory);
}

/**
 * Create an agent adapter from configuration.
 * Looks up the registered factory for the given agentType and creates an instance.
 *
 * @param config Agent adapter configuration (includes agentType)
 * @returns A new AgentAdapter instance
 * @throws If no factory is registered for the agentType
 */
export function createAgentAdapter(config: AgentAdapterConfig): AgentAdapter {
  const validated = AgentAdapterConfigSchema.parse(config);
  const factory = adapterFactories.get(validated.agentType);
  if (!factory) {
    const registered = Array.from(adapterFactories.keys());
    throw new Error(
      `Unknown agent type: '${validated.agentType}'. Registered types: [${registered.join(', ')}]`
    );
  }
  return factory(validated);
}

/**
 * Get all registered agent type identifiers.
 */
export function getRegisteredAgentTypes(): string[] {
  return Array.from(adapterFactories.keys());
}

/**
 * Check if an agent type is registered.
 */
export function hasAgentType(agentType: string): boolean {
  return adapterFactories.has(agentType);
}

/**
 * Clear all registered adapters. Intended for testing only.
 */
export function clearAgentAdapterRegistry(): void {
  adapterFactories.clear();
}
