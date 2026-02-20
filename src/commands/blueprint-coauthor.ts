/**
 * ABOUTME: Blueprint co-authoring subcommands (init, add, list, status).
 * Manages blueprint.json files with AI-generated acceptance criteria via Anthropic API.
 * Used by executeBlueprintCommand when subcommand is init|add|list|status.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Blueprint, BlueprintCriterion } from './blueprint.js';

const BLUEPRINT_FILE = 'blueprint.json';

/**
 * Load blueprint.json from a project directory.
 */
function loadBlueprintJson(projectDir: string): Blueprint | null {
  const path = join(projectDir, BLUEPRINT_FILE);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Blueprint;
  } catch {
    return null;
  }
}

/**
 * Save blueprint.json to a project directory (updates lastModified).
 */
function saveBlueprintJson(projectDir: string, blueprint: Blueprint): void {
  const path = join(projectDir, BLUEPRINT_FILE);
  blueprint.metadata.lastModified = new Date().toISOString();
  writeFileSync(path, JSON.stringify(blueprint, null, 2) + '\n');
}

/**
 * Call Anthropic API (Claude Opus) to generate 3–5 acceptance criteria
 * from a plain-language feature description.
 */
async function callOpusForCriteria(
  description: string,
  nextId: number,
): Promise<BlueprintCriterion[]> {
  const apiKey = process.env['ANTHROPIC_API_KEY'] ?? '';
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable not set');
  }

  const prompt = `Generate 3-5 concrete, verifiable acceptance criteria for the following feature or requirement:

"${description}"

Output ONLY a JSON array of criteria objects, no explanation or prose:
[
  {"id": "AC-${nextId}", "description": "...", "priority": "P0", "met": false},
  {"id": "AC-${nextId + 1}", "description": "...", "priority": "P1", "met": false}
]

Rules:
- Use sequential IDs starting at AC-${nextId}
- Priority: P0 = must-have (blocks release), P1 = should-have, P2 = nice-to-have
- Descriptions must be specific and testable, not vague
- 3-5 criteria total`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };
  const text = data.content.find((b) => b.type === 'text')?.text ?? '';

  // Extract JSON array from response (model may wrap it in prose/code fences)
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) {
    throw new Error(`Could not parse criteria JSON from response:\n${text}`);
  }

  return JSON.parse(match[0]) as BlueprintCriterion[];
}

/**
 * choraforge blueprint init [project-dir]
 * Scaffolds an empty blueprint.json in the given directory (default: cwd).
 */
export async function executeBlueprintInitCommand(args: string[]): Promise<void> {
  const projectDir = resolve(args[0] ?? process.cwd());
  const blueprintPath = join(projectDir, BLUEPRINT_FILE);

  if (existsSync(blueprintPath)) {
    console.log(`Blueprint already exists: ${blueprintPath}`);
    console.log('Use "choraforge blueprint add <description>" to add criteria.');
    return;
  }

  mkdirSync(projectDir, { recursive: true });

  const blueprint: Blueprint = {
    vision: '',
    criteria: [],
    constraints: [],
    outOfScope: [],
    metadata: {
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      version: 1,
    },
  };

  writeFileSync(blueprintPath, JSON.stringify(blueprint, null, 2) + '\n');

  console.log(`Blueprint initialized: ${blueprintPath}`);
  console.log('');
  console.log('Next steps:');
  console.log('  choraforge blueprint add "describe your feature or requirement"');
  console.log('  choraforge blueprint list');
}

/**
 * choraforge blueprint add "<description>"
 * Generates 3–5 acceptance criteria via Claude Opus and appends them to blueprint.json.
 */
export async function executeBlueprintAddCommand(args: string[]): Promise<void> {
  const description = args
    .filter((a) => !a.startsWith('--'))
    .join(' ')
    .trim();

  if (!description) {
    console.error('Usage: choraforge blueprint add "<feature description>"');
    process.exit(1);
  }

  const cwd = process.cwd();
  let blueprint = loadBlueprintJson(cwd);

  if (!blueprint) {
    // Auto-init if blueprint.json is missing
    blueprint = {
      vision: '',
      criteria: [],
      constraints: [],
      outOfScope: [],
      metadata: {
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        version: 1,
      },
    };
  }

  const nextId = blueprint.criteria.length + 1;

  console.log('Generating acceptance criteria via Claude Opus...');
  console.log('');

  let newCriteria: BlueprintCriterion[];
  try {
    newCriteria = await callOpusForCriteria(description, nextId);
  } catch (err) {
    console.error(
      `Failed to generate criteria: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  console.log(`Generated ${newCriteria.length} criteria:`);
  for (const c of newCriteria) {
    console.log(`  ${c.id} [${c.priority}]: ${c.description}`);
  }
  console.log('');

  blueprint.criteria.push(...newCriteria);
  saveBlueprintJson(cwd, blueprint);

  console.log(`Appended to blueprint.json (${blueprint.criteria.length} total criteria)`);
}

/**
 * choraforge blueprint list [project-dir]
 * Displays a formatted table of all acceptance criteria with met/unmet status.
 */
export async function executeBlueprintListCommand(args: string[]): Promise<void> {
  const projectDir = resolve(args[0] ?? process.cwd());
  const blueprint = loadBlueprintJson(projectDir);

  if (!blueprint) {
    console.error(`No blueprint.json found in: ${projectDir}`);
    console.error('Run "choraforge blueprint init" to create one.');
    process.exit(1);
  }

  if (blueprint.criteria.length === 0) {
    console.log('No acceptance criteria yet.');
    console.log('Use "choraforge blueprint add <description>" to generate criteria.');
    return;
  }

  const green = '\x1b[32m';
  const red = '\x1b[31m';
  const reset = '\x1b[0m';
  const bold = '\x1b[1m';

  console.log(`${bold}ID       Priority  Met    Description${reset}`);
  console.log('─'.repeat(78));

  for (const c of blueprint.criteria) {
    const metStr = c.met ? `${green}✓ yes${reset}` : `${red}✗ no ${reset}`;
    const idPad = c.id.padEnd(8);
    const priPad = c.priority.padEnd(9);
    const desc =
      c.description.length > 52 ? c.description.slice(0, 49) + '...' : c.description;
    console.log(`${idPad} ${priPad} ${metStr}  ${desc}`);
  }
}

/**
 * choraforge blueprint status [project-dir]
 * Shows overall progress summary grouped by priority.
 */
export async function executeBlueprintStatusCommand(args: string[]): Promise<void> {
  const projectDir = resolve(args[0] ?? process.cwd());
  const blueprint = loadBlueprintJson(projectDir);

  if (!blueprint) {
    console.error(`No blueprint.json found in: ${projectDir}`);
    console.error('Run "choraforge blueprint init" to create one.');
    process.exit(1);
  }

  const total = blueprint.criteria.length;
  const met = blueprint.criteria.filter((c) => c.met).length;
  const pct = total > 0 ? Math.round((met / total) * 100) : 0;

  console.log(`Blueprint Status: ${met}/${total} criteria met (${pct}%)`);

  if (blueprint.vision) {
    const visionPreview =
      blueprint.vision.length > 100
        ? blueprint.vision.slice(0, 97) + '...'
        : blueprint.vision;
    console.log(`Vision: ${visionPreview}`);
  }

  console.log('');

  const priorities = [
    { key: 'P0', label: 'must-have' },
    { key: 'P1', label: 'should-have' },
    { key: 'P2', label: 'nice-to-have' },
  ] as const;

  for (const { key, label } of priorities) {
    const group = blueprint.criteria.filter((c) => c.priority === key);
    if (group.length === 0) continue;
    const groupMet = group.filter((c) => c.met).length;
    console.log(`  ${key} (${label}): ${groupMet}/${group.length} met`);
  }

  const p0Unmet = blueprint.criteria.filter((c) => !c.met && c.priority === 'P0').length;
  if (p0Unmet > 0) {
    console.log('');
    console.log(`⚠  ${p0Unmet} P0 (must-have) criteria still unmet — release blocked`);
  } else if (total > 0 && met === total) {
    console.log('');
    console.log('✓  All criteria met — ready for release');
  }
}
