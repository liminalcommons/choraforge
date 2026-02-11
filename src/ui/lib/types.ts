/**
 * ABOUTME: Shared type definitions for the ChoraForge web UI.
 * Re-exports and extends types from the engine for UI consumption.
 */

/** Evolution status (mirrors engine type) */
export type EvolutionStatus = 'idle' | 'analyzing' | 'spawning' | 'scoring' | 'merging' | 'complete' | 'stopped';

/** App status from registry */
export type AppStatus = 'idle' | 'running' | 'stopped' | 'error';

/** Cell status (simplified for UI) */
export interface CellStatusUI {
  status: 'creating' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
  containerId?: string;
}

/** Agent adapter status */
export type AgentAdapterStatusUI =
  | { state: 'idle' }
  | { state: 'evolving'; currentTask: string; criterionId: string }
  | { state: 'stopped'; reason: string }
  | { state: 'error'; error: string };

/** Evolution progress for an app */
export interface EvolutionProgressUI {
  totalGaps: number;
  gapsCompleted: number;
  currentGap: string | null;
  running: boolean;
}

/** Combined status for an app from multi-app API */
export interface AppCellStatusUI {
  appId: string;
  appName: string;
  appStatus: AppStatus;
  cell: CellStatusUI;
  agent: AgentAdapterStatusUI;
  evolution: EvolutionProgressUI;
}

/** Blueprint criterion */
export interface BlueprintCriterion {
  id: string;
  description: string;
  priority: 'P0' | 'P1' | 'P2';
  met: boolean;
}

/** Blueprint */
export interface Blueprint {
  vision: string;
  criteria: BlueprintCriterion[];
  constraints: string[];
  outOfScope: string[];
  metadata: { createdAt: string; lastModified: string; version: number };
}

/** Version summary (mirrors engine type) */
export interface VersionSummary {
  version: number;
  timestamp: string;
  gitTag: string;
  criteriaMetBefore: string[];
  criteriaMetAfter: string[];
  criteriaDelta: string[];
  selectedAgent: string;
  qualityScore: number;
  durationMs: number;
  screenshotPath: string | null;
  reportPath: string;
}

/** Variant score */
export interface VariantScore {
  workerId: string;
  taskId: string;
  agentId: string;
  diff: string;
  criteriaAddressed: string[];
  qualityScore: number;
  rationale: string;
  recommended: boolean;
}

/** Evolution report */
export interface EvolutionReport {
  version: number;
  timestamp: string;
  tasksGenerated: number;
  tasksCompleted: number;
  variantsSpawned: number;
  variantsSelected: number;
  criteriaMetBefore: string[];
  criteriaMetAfter: string[];
  criteriaDelta: string[];
  agentUsage: Record<string, number>;
  selectedVariants: VariantScore[];
  durationMs: number;
}

/** Remote evolution state (from WebSocket) */
export interface RemoteEvolutionState {
  appId: string;
  appName: string;
  status: EvolutionStatus;
  currentVersion: number;
  blueprint: Blueprint | null;
  versions: VersionSummary[];
}

/** Version detail (from WebSocket) */
export interface RemoteVersionDetail {
  summary: VersionSummary;
  report: EvolutionReport | null;
  allScores: VariantScore[];
  agentUsage: Record<string, number>;
}

/** Evolution event (from WebSocket) */
export type EvolutionEvent =
  | { type: 'evolution:started'; maxVersions: number }
  | { type: 'evolution:version-started'; version: number }
  | { type: 'evolution:gap-analysis'; tasksGenerated: number }
  | { type: 'evolution:variants-spawned'; count: number }
  | { type: 'evolution:variant-scored'; score: VariantScore }
  | { type: 'evolution:variant-selected'; score: VariantScore }
  | { type: 'evolution:version-complete'; report: EvolutionReport }
  | { type: 'evolution:complete'; totalVersions: number }
  | { type: 'evolution:stopped'; reason: string }
  | { type: 'evolution:error'; error: string };
