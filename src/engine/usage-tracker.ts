/**
 * ABOUTME: Per-model usage tracking for ChoraForge evolution engine.
 * Monitors API capacity across models (Opus, Kimi, GLM) and provides
 * routing decisions based on availability and rate limit state.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Capacity state for a single model/agent.
 */
export interface ModelCapacity {
  id: string;
  available: boolean;
  lastCheck: Date;
  lastUsed?: Date;
  rateLimitedAt?: Date;
  rateLimitedUntil?: Date;
  method: 'rate-limit-detect' | 'api-balance' | 'always-available';
  totalInvocations: number;
  totalTokensEstimate: number;
}

/**
 * Single usage log entry written to JSONL.
 */
export interface UsageLogEntry {
  timestamp: string;
  agent: string;
  model?: string;
  taskId: string;
  action: 'start' | 'complete' | 'rate-limited' | 'error';
  durationMs?: number;
  tokensEstimate?: number;
  error?: string;
}

/**
 * Configuration for the usage tracker.
 */
export interface UsageTrackerConfig {
  logPath: string; // Path to usage-log.jsonl
  models: Record<string, {
    method: 'rate-limit-detect' | 'api-balance' | 'always-available';
    rateLimitCooldownMs?: number; // How long to wait after rate limit (default: 60000)
  }>;
}

const DEFAULT_COOLDOWN_MS = 60_000; // 1 minute

/**
 * Tracks per-model usage and availability for the evolution engine.
 */
export class UsageTracker {
  private capacities: Map<string, ModelCapacity> = new Map();
  private config: UsageTrackerConfig;

  constructor(config: UsageTrackerConfig) {
    this.config = config;

    // Initialize capacity state for each configured model
    for (const [id, modelConfig] of Object.entries(config.models)) {
      this.capacities.set(id, {
        id,
        available: true,
        lastCheck: new Date(),
        method: modelConfig.method,
        totalInvocations: 0,
        totalTokensEstimate: 0,
      });
    }

    // Ensure log directory exists
    const logDir = dirname(config.logPath);
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
  }

  /**
   * Check if any model is still available for execution.
   */
  anyAvailable(): boolean {
    this.refreshCooldowns();
    return Array.from(this.capacities.values()).some(c => c.available);
  }

  /**
   * Get all available model IDs.
   */
  getAvailableModels(): string[] {
    this.refreshCooldowns();
    return Array.from(this.capacities.values())
      .filter(c => c.available)
      .map(c => c.id);
  }

  /**
   * Get the capacity state for a specific model.
   */
  getCapacity(modelId: string): ModelCapacity | undefined {
    this.refreshCooldowns();
    return this.capacities.get(modelId);
  }

  /**
   * Mark a model as rate-limited.
   */
  markRateLimited(modelId: string): void {
    const capacity = this.capacities.get(modelId);
    if (!capacity) return;

    const cooldownMs = this.config.models[modelId]?.rateLimitCooldownMs ?? DEFAULT_COOLDOWN_MS;

    capacity.available = false;
    capacity.rateLimitedAt = new Date();
    capacity.rateLimitedUntil = new Date(Date.now() + cooldownMs);
    capacity.lastCheck = new Date();

    this.log({
      timestamp: new Date().toISOString(),
      agent: modelId,
      taskId: '',
      action: 'rate-limited',
    });
  }

  /**
   * Mark a model as available (e.g., after successful recovery check).
   */
  markAvailable(modelId: string): void {
    const capacity = this.capacities.get(modelId);
    if (!capacity) return;

    capacity.available = true;
    capacity.rateLimitedAt = undefined;
    capacity.rateLimitedUntil = undefined;
    capacity.lastCheck = new Date();
  }

  /**
   * Record usage of a model for a task.
   */
  recordUsage(entry: UsageLogEntry): void {
    const capacity = this.capacities.get(entry.agent);
    if (capacity) {
      capacity.totalInvocations++;
      capacity.lastUsed = new Date();
      if (entry.tokensEstimate) {
        capacity.totalTokensEstimate += entry.tokensEstimate;
      }
    }

    this.log(entry);
  }

  /**
   * Get a summary of usage across all models.
   */
  getSummary(): Record<string, { invocations: number; tokensEstimate: number; available: boolean }> {
    this.refreshCooldowns();
    const summary: Record<string, { invocations: number; tokensEstimate: number; available: boolean }> = {};

    for (const [id, capacity] of this.capacities) {
      summary[id] = {
        invocations: capacity.totalInvocations,
        tokensEstimate: capacity.totalTokensEstimate,
        available: capacity.available,
      };
    }

    return summary;
  }

  /**
   * Load existing usage log entries (for reporting).
   */
  loadLog(): UsageLogEntry[] {
    if (!existsSync(this.config.logPath)) return [];

    const content = readFileSync(this.config.logPath, 'utf-8');
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try {
          return JSON.parse(line) as UsageLogEntry;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is UsageLogEntry => entry !== null);
  }

  /**
   * Refresh cooldown states — models whose cooldown has expired become available again.
   */
  private refreshCooldowns(): void {
    const now = Date.now();
    for (const capacity of this.capacities.values()) {
      if (!capacity.available && capacity.rateLimitedUntil) {
        if (now >= capacity.rateLimitedUntil.getTime()) {
          capacity.available = true;
          capacity.rateLimitedAt = undefined;
          capacity.rateLimitedUntil = undefined;
          capacity.lastCheck = new Date();
        }
      }
    }
  }

  /**
   * Append a log entry to the JSONL file.
   */
  private log(entry: UsageLogEntry): void {
    try {
      appendFileSync(this.config.logPath, JSON.stringify(entry) + '\n');
    } catch {
      // Silently ignore log write failures
    }
  }
}
