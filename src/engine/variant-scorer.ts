/**
 * ABOUTME: Variant scorer for ChoraForge evolution engine.
 * After ParallelExecutor completes, scores each variant's diff against
 * the blueprint acceptance criteria using Opus, then ranks them for merging.
 */

import type { Blueprint } from '../commands/blueprint.js';
import type { AgentPlugin, AgentExecuteOptions } from '../plugins/agents/types.js';

/**
 * Result of scoring a single variant.
 */
export interface VariantScore {
  /** Worker/worktree ID that produced this variant */
  workerId: string;
  /** Task ID the variant was working on */
  taskId: string;
  /** Agent that produced this variant */
  agentId: string;
  /** Git diff of the variant against the base branch */
  diff: string;
  /** Which acceptance criteria this variant addresses */
  criteriaAddressed: string[];
  /** Quality score (0-100) */
  qualityScore: number;
  /** Opus's explanation of the score */
  rationale: string;
  /** Whether this variant should be merged */
  recommended: boolean;
}

/**
 * Configuration for the variant scorer.
 */
export interface VariantScorerConfig {
  /** Agent to use for scoring (typically Opus) */
  scoringAgent: AgentPlugin;
  /** Working directory */
  cwd: string;
  /** Timeout for scoring call in ms */
  timeout?: number;
}

/**
 * Diff input for a single variant to be scored.
 */
export interface VariantDiff {
  workerId: string;
  taskId: string;
  agentId: string;
  diff: string;
  commitCount: number;
}

const SCORING_PROMPT_TEMPLATE = `You are evaluating code variants produced by AI agents for an evolutionary development process.

## Blueprint Acceptance Criteria

{{criteriaList}}

## Variants to Score

{{variantDiffs}}

## Instructions

For each variant, evaluate:
1. **Criteria Addressed**: Which acceptance criteria (AC-1, AC-2, etc.) does this diff work toward?
2. **Quality Score** (0-100): How well-written, complete, and correct is the code?
   - 90-100: Excellent - production ready, addresses criteria fully
   - 70-89: Good - solid implementation with minor gaps
   - 50-69: Acceptable - works but needs improvement
   - 30-49: Below average - partial implementation or notable issues
   - 0-29: Poor - broken, wrong approach, or minimal progress
3. **Recommendation**: Should this variant be merged?

## Output Format

Output your evaluation as JSON (no markdown fences):
[
  {
    "workerId": "worker-0",
    "criteriaAddressed": ["AC-1", "AC-3"],
    "qualityScore": 85,
    "rationale": "Brief explanation",
    "recommended": true
  }
]
`;

/**
 * Scores variants against blueprint criteria using an AI agent.
 */
export class VariantScorer {
  private config: VariantScorerConfig;

  constructor(config: VariantScorerConfig) {
    this.config = config;
  }

  /**
   * Score a set of variant diffs against the blueprint.
   * Returns scored variants sorted by quality (highest first).
   */
  async score(variants: VariantDiff[], blueprint: Blueprint): Promise<VariantScore[]> {
    if (variants.length === 0) return [];

    // Build the scoring prompt
    const criteriaList = blueprint.criteria
      .map(c => `- ${c.id} [${c.priority}]: ${c.description}${c.met ? ' (ALREADY MET)' : ''}`)
      .join('\n');

    const variantDiffs = variants
      .map((v, i) => [
        `### Variant ${i + 1} (${v.workerId}, agent: ${v.agentId}, task: ${v.taskId}, ${v.commitCount} commits)`,
        '```diff',
        v.diff.slice(0, 10000), // Truncate very large diffs
        v.diff.length > 10000 ? `\n... (truncated, ${v.diff.length} total characters)` : '',
        '```',
      ].join('\n'))
      .join('\n\n');

    const prompt = SCORING_PROMPT_TEMPLATE
      .replace('{{criteriaList}}', criteriaList)
      .replace('{{variantDiffs}}', variantDiffs);

    // Execute the scoring agent
    let output = '';
    const handle = this.config.scoringAgent.execute(prompt, undefined, {
      cwd: this.config.cwd,
      timeout: this.config.timeout ?? 120_000,
      onStdout: (data: string) => {
        output += data;
      },
    } as AgentExecuteOptions);

    const result = await handle.promise;
    const fullOutput = output || result.stdout;

    // Parse the JSON response
    const scores = this.parseScores(fullOutput, variants);

    // Sort by quality score descending
    return scores.sort((a, b) => b.qualityScore - a.qualityScore);
  }

  /**
   * Select the best variant for merging from scored results.
   */
  selectBest(scores: VariantScore[]): VariantScore | null {
    const recommended = scores.filter(s => s.recommended);
    if (recommended.length === 0) return null;
    return recommended[0]!;
  }

  /**
   * Parse scoring output into VariantScore objects.
   */
  private parseScores(output: string, variants: VariantDiff[]): VariantScore[] {
    // Try to extract JSON array from output (greedy to match outermost brackets)
    const jsonMatch = output.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      // Fallback: give all variants equal scores
      return variants.map(v => ({
        workerId: v.workerId,
        taskId: v.taskId,
        agentId: v.agentId,
        diff: v.diff,
        criteriaAddressed: [],
        qualityScore: 50,
        rationale: 'Scoring output could not be parsed',
        recommended: true,
      }));
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        workerId: string;
        criteriaAddressed?: string[];
        qualityScore?: number;
        rationale?: string;
        recommended?: boolean;
      }>;

      return parsed.map((score, i) => {
        const variant = variants.find(v => v.workerId === score.workerId) ?? variants[i];
        return {
          workerId: score.workerId || variant?.workerId || `worker-${i}`,
          taskId: variant?.taskId || '',
          agentId: variant?.agentId || '',
          diff: variant?.diff || '',
          criteriaAddressed: score.criteriaAddressed || [],
          qualityScore: typeof score.qualityScore === 'number' ? score.qualityScore : 50,
          rationale: score.rationale || '',
          recommended: score.recommended !== false,
        };
      });
    } catch {
      return variants.map(v => ({
        workerId: v.workerId,
        taskId: v.taskId,
        agentId: v.agentId,
        diff: v.diff,
        criteriaAddressed: [],
        qualityScore: 50,
        rationale: 'JSON parse error in scoring output',
        recommended: true,
      }));
    }
  }
}
