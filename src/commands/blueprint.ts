/**
 * ABOUTME: Blueprint co-authoring command for ChoraForge.
 * Starts an interactive Opus session to co-author a project vision
 * with numbered acceptance criteria. Output: evolution/blueprint.md
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { getAgentRegistry } from '../plugins/agents/registry.js';
import { registerBuiltinAgents } from '../plugins/agents/builtin/index.js';
import type { AgentExecuteOptions } from '../plugins/agents/types.js';
import {
  executeBlueprintInitCommand,
  executeBlueprintAddCommand,
  executeBlueprintListCommand,
  executeBlueprintStatusCommand,
} from './blueprint-coauthor.js';

/**
 * Blueprint format representing the co-authored project vision.
 */
export interface Blueprint {
  vision: string;
  criteria: BlueprintCriterion[];
  constraints: string[];
  outOfScope: string[];
  metadata: {
    createdAt: string;
    lastModified: string;
    version: number;
  };
}

export interface BlueprintCriterion {
  id: string;        // AC-1, AC-2, ...
  description: string;
  priority: 'P0' | 'P1' | 'P2';
  met: boolean;
}

interface BlueprintArgs {
  cwd: string;
  outputPath: string;
  agent: string;
  model: string;
  help: boolean;
}

const BLUEPRINT_SYSTEM_PROMPT = `You are a senior software architect co-authoring a project blueprint with the user.

Your goal is to help the user define a clear, actionable project vision with measurable acceptance criteria.

## Process

1. **Ask clarifying questions** (2-3 rounds) to understand:
   - What problem does this solve?
   - Who are the users?
   - What does success look like?
   - What are the constraints?

2. **Draft the blueprint** with these sections:
   - **Vision**: 2-3 sentence summary of what we're building and why
   - **Acceptance Criteria**: Numbered list (AC-1, AC-2, ...) with priority (P0/P1/P2)
     - P0 = Must have (blocks release)
     - P1 = Should have (important but not blocking)
     - P2 = Nice to have (if time permits)
   - **Constraints**: Technical or business constraints
   - **Out of Scope**: Explicitly excluded items

3. **Refine with the user** until they approve the blueprint.

## Output Format

When the user approves, output the final blueprint wrapped in markers:

[BLUEPRINT]
# Vision
{vision text}

# Acceptance Criteria
- AC-1 [P0]: {description}
- AC-2 [P0]: {description}
- AC-3 [P1]: {description}
...

# Constraints
- {constraint 1}
- {constraint 2}

# Out of Scope
- {item 1}
- {item 2}
[/BLUEPRINT]

After outputting the blueprint, say: <promise>COMPLETE</promise>
`;

/**
 * Parse blueprint command arguments.
 */
export function parseBlueprintArgs(args: string[]): BlueprintArgs {
  const result: BlueprintArgs = {
    cwd: process.cwd(),
    outputPath: '',
    agent: 'claude',
    model: 'opus',
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if ((arg === '--cwd' || arg === '-C') && args[i + 1]) {
      result.cwd = resolve(args[++i]!);
    } else if ((arg === '--output' || arg === '-o') && args[i + 1]) {
      result.outputPath = args[++i]!;
    } else if (arg === '--agent' && args[i + 1]) {
      result.agent = args[++i]!;
    } else if (arg === '--model' && args[i + 1]) {
      result.model = args[++i]!;
    }
  }

  if (!result.outputPath) {
    result.outputPath = join(result.cwd, 'evolution', 'blueprint.md');
  }

  return result;
}

/**
 * Print blueprint command help.
 */
export function printBlueprintHelp(): void {
  console.log(`
choraforge blueprint - Co-author a project blueprint with AI

Usage: choraforge blueprint [options]

Options:
  --agent <name>      Agent to use for co-authoring (default: claude)
  --model <name>      Model to use (default: opus)
  --output, -o <path> Output file path (default: evolution/blueprint.md)
  --cwd, -C <path>    Working directory
  --help, -h          Show this help message

Description:
  Starts an interactive AI session to co-author a project vision
  with numbered acceptance criteria. The blueprint guides the
  evolution engine's gap analysis and variant selection.

  The blueprint includes:
  - Vision statement (what we're building and why)
  - Acceptance criteria (AC-1, AC-2, ... with P0/P1/P2 priorities)
  - Constraints (technical or business)
  - Out of scope (explicitly excluded items)

Examples:
  choraforge blueprint                     # Start blueprint co-authoring
  choraforge blueprint --model sonnet      # Use Sonnet instead of Opus
  choraforge blueprint -o custom/path.md   # Custom output path
`);
}

/**
 * Parse a blueprint markdown string into a structured Blueprint object.
 */
export function parseBlueprint(content: string): Blueprint {
  const criteria: BlueprintCriterion[] = [];
  const constraints: string[] = [];
  const outOfScope: string[] = [];
  let vision = '';

  // Extract content between [BLUEPRINT] markers if present
  const markerMatch = content.match(/\[BLUEPRINT\]([\s\S]*?)\[\/BLUEPRINT\]/);
  const text = markerMatch ? markerMatch[1]! : content;

  let currentSection = '';

  for (const line of text.split('\n')) {
    const trimmed = line.trim();

    if (trimmed.startsWith('# Vision')) {
      currentSection = 'vision';
      continue;
    } else if (trimmed.startsWith('# Acceptance Criteria')) {
      currentSection = 'criteria';
      continue;
    } else if (trimmed.startsWith('# Constraints')) {
      currentSection = 'constraints';
      continue;
    } else if (trimmed.startsWith('# Out of Scope')) {
      currentSection = 'outOfScope';
      continue;
    }

    if (!trimmed) continue;

    switch (currentSection) {
      case 'vision':
        vision += (vision ? '\n' : '') + trimmed;
        break;
      case 'criteria': {
        // Parse: - AC-1 [P0]: description
        const criterionMatch = trimmed.match(/^-\s*(AC-\d+)\s*\[(P[012])\]:\s*(.+)$/);
        if (criterionMatch) {
          criteria.push({
            id: criterionMatch[1]!,
            priority: criterionMatch[2]! as 'P0' | 'P1' | 'P2',
            description: criterionMatch[3]!,
            met: false,
          });
        }
        break;
      }
      case 'constraints':
        if (trimmed.startsWith('- ')) {
          constraints.push(trimmed.slice(2));
        }
        break;
      case 'outOfScope':
        if (trimmed.startsWith('- ')) {
          outOfScope.push(trimmed.slice(2));
        }
        break;
    }
  }

  return {
    vision,
    criteria,
    constraints,
    outOfScope,
    metadata: {
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      version: 1,
    },
  };
}

/**
 * Serialize a Blueprint object back to markdown.
 */
export function serializeBlueprint(blueprint: Blueprint): string {
  const lines: string[] = [
    '# Vision',
    blueprint.vision,
    '',
    '# Acceptance Criteria',
  ];

  for (const criterion of blueprint.criteria) {
    const status = criterion.met ? ' ✓' : '';
    lines.push(`- ${criterion.id} [${criterion.priority}]: ${criterion.description}${status}`);
  }

  lines.push('', '# Constraints');
  for (const constraint of blueprint.constraints) {
    lines.push(`- ${constraint}`);
  }

  lines.push('', '# Out of Scope');
  for (const item of blueprint.outOfScope) {
    lines.push(`- ${item}`);
  }

  lines.push('', `<!-- metadata: ${JSON.stringify(blueprint.metadata)} -->`);

  return lines.join('\n') + '\n';
}

/**
 * Load an existing blueprint from disk.
 */
export function loadBlueprint(path: string): Blueprint | null {
  if (!existsSync(path)) return null;
  const content = readFileSync(path, 'utf-8');
  return parseBlueprint(content);
}

/**
 * Execute the blueprint command.
 * In headless mode, runs agent with system prompt and stdin,
 * captures output, parses blueprint, and saves to disk.
 */
export async function executeBlueprintCommand(args: string[]): Promise<void> {
  // Dispatch co-authoring subcommands
  const sub = args[0];
  if (sub === 'init') { await executeBlueprintInitCommand(args.slice(1)); return; }
  if (sub === 'add') { await executeBlueprintAddCommand(args.slice(1)); return; }
  if (sub === 'list') { await executeBlueprintListCommand(args.slice(1)); return; }
  if (sub === 'status') { await executeBlueprintStatusCommand(args.slice(1)); return; }

  const parsedArgs = parseBlueprintArgs(args);

  if (parsedArgs.help) {
    printBlueprintHelp();
    return;
  }

  console.log('ChoraForge Blueprint Co-Authoring');
  console.log('─'.repeat(50));
  console.log(`Output: ${parsedArgs.outputPath}`);
  console.log(`Agent: ${parsedArgs.agent} (model: ${parsedArgs.model})`);
  console.log('');

  // Ensure output directory exists
  const outputDir = dirname(parsedArgs.outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Initialize agent registry
  registerBuiltinAgents();
  const registry = getAgentRegistry();

  // Get agent
  const agent = registry.createInstance(parsedArgs.agent);
  if (!agent) {
    console.error(`Agent "${parsedArgs.agent}" not found. Available: ${registry.getRegisteredPlugins().map(a => a.id).join(', ')}`);
    process.exit(1);
  }
  await agent.initialize({
    model: parsedArgs.model,
    skipPermissions: true,
  });

  // Detect agent availability
  const detectResult = await agent.detect();
  if (!detectResult.available) {
    console.error(`Agent "${parsedArgs.agent}" not available: ${detectResult.error}`);
    process.exit(1);
  }

  console.log(`Using ${agent.meta.name} v${detectResult.version}`);
  console.log('');
  console.log('Starting blueprint co-authoring session...');
  console.log('The agent will ask you questions to define the project vision.');
  console.log('');

  // Build the prompt — for now, a simple single-shot that asks the agent
  // to guide the user through blueprint creation
  const prompt = BLUEPRINT_SYSTEM_PROMPT + '\n\nBegin by introducing yourself and asking the user about their project.';

  // Execute agent
  let output = '';
  const handle = agent.execute(prompt, undefined, {
    cwd: parsedArgs.cwd,
    onStdout: (data: string) => {
      output += data;
      process.stdout.write(data);
    },
    onStderr: (data: string) => {
      process.stderr.write(data);
    },
  } as AgentExecuteOptions);

  const result = await handle.promise;

  if (result.status === 'failed') {
    console.error(`\nBlueprint session failed: ${result.error}`);
    process.exit(1);
  }

  // Parse blueprint from output
  const fullOutput = output || result.stdout;
  const blueprintMatch = fullOutput.match(/\[BLUEPRINT\]([\s\S]*?)\[\/BLUEPRINT\]/);

  if (!blueprintMatch) {
    console.log('\nNo blueprint markers found in output. Saving raw output.');
    writeFileSync(parsedArgs.outputPath, fullOutput);
    console.log(`Saved raw output to: ${parsedArgs.outputPath}`);
    return;
  }

  // Parse and save structured blueprint
  const blueprint = parseBlueprint(fullOutput);
  const serialized = serializeBlueprint(blueprint);
  writeFileSync(parsedArgs.outputPath, serialized);

  console.log('');
  console.log('─'.repeat(50));
  console.log(`Blueprint saved to: ${parsedArgs.outputPath}`);
  console.log(`  Vision: ${blueprint.vision.slice(0, 80)}...`);
  console.log(`  Criteria: ${blueprint.criteria.length} acceptance criteria`);
  console.log(`    P0 (must-have): ${blueprint.criteria.filter(c => c.priority === 'P0').length}`);
  console.log(`    P1 (should-have): ${blueprint.criteria.filter(c => c.priority === 'P1').length}`);
  console.log(`    P2 (nice-to-have): ${blueprint.criteria.filter(c => c.priority === 'P2').length}`);
  console.log(`  Constraints: ${blueprint.constraints.length}`);
  console.log(`  Out of scope: ${blueprint.outOfScope.length}`);
}
