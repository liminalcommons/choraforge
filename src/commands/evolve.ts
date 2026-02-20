/**
 * ABOUTME: evolve command — wires EvolutionEngine into the choraforge CLI.
 * Loads blueprint.json + .choraforge.yaml, initializes agents, and runs the
 * 9-step evolution loop, streaming events to the terminal.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { EvolutionEngine } from '../engine/evolution.js';
import type { EvolutionConfig } from '../engine/evolution.js';
import { VersionRegistry } from '../engine/version-registry.js';
import { getAgentRegistry } from '../plugins/agents/registry.js';
import { registerBuiltinAgents } from '../plugins/agents/builtin/index.js';
import type { AgentPlugin } from '../plugins/agents/types.js';
import type { StoredConfig } from '../config/types.js';
import type { Blueprint } from './blueprint.js';

// ── Arg parsing ────────────────────────────────────────────────────────────

interface EvolveArgs {
  projectDir: string;
  status: boolean;
  maxVersions: number;
  variantsPerTask: number;
  maxWorkers: number;
  blueprintPath: string | null;
  configPath: string | null;
  help: boolean;
}

export function parseEvolveArgs(args: string[]): EvolveArgs {
  const result: EvolveArgs = {
    projectDir: process.cwd(),
    status: false,
    maxVersions: 10,
    variantsPerTask: 3,
    maxWorkers: 3,
    blueprintPath: null,
    configPath: null,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--status') {
      result.status = true;
    } else if (arg === '--max-versions' && args[i + 1]) {
      result.maxVersions = parseInt(args[++i]!, 10);
    } else if (arg === '--variants' && args[i + 1]) {
      result.variantsPerTask = parseInt(args[++i]!, 10);
    } else if (arg === '--max-workers' && args[i + 1]) {
      result.maxWorkers = parseInt(args[++i]!, 10);
    } else if (arg === '--blueprint' && args[i + 1]) {
      result.blueprintPath = args[++i]!;
    } else if (arg === '--config' && args[i + 1]) {
      result.configPath = args[++i]!;
    } else if (!arg.startsWith('-')) {
      result.projectDir = resolve(arg);
    }
  }

  return result;
}

export function printEvolveHelp(): void {
  console.log(`
choraforge evolve - Run the ChoraForge evolution engine

Usage: choraforge evolve [project-dir] [options]

Arguments:
  project-dir           Project directory (default: current directory)

Options:
  --status              Show version history instead of running evolution
  --max-versions N      Maximum evolution versions to run (default: 10)
  --variants N          Variants to spawn per task (default: 3)
  --max-workers N       Parallel workers (default: 3)
  --blueprint <path>    Override blueprint.json path
  --config <path>       Override .choraforge.yaml path
  --help, -h            Show this help

Description:
  Runs the 9-step evolution loop against a blueprint.json:
  1. Load blueprint and run gap analysis via Opus
  2. Spawn N variants in parallel, one agent per unmet criterion
  3. Score variants via Opus and select the best
  4. Merge selected variant and tag the version
  5. Mark acceptance criteria as met
  6. Write evolution report
  7. (Optional) Capture screenshot
  8. Repeat until all criteria met or max versions reached

Examples:
  choraforge evolve                         # Evolve current directory
  choraforge evolve ./my-app                # Evolve a specific project
  choraforge evolve --status ./my-app       # Show version history
  choraforge evolve --max-versions 3        # Run up to 3 versions
`);
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Load stored config from .choraforge.yaml in project dir or override path.
 */
export function loadStoredConfigFromDir(
  projectDir: string,
  configPath: string | null,
): StoredConfig | null {
  const candidates = configPath
    ? [configPath]
    : [
        join(projectDir, '.choraforge.yaml'),
        join(projectDir, '.choraforge.yml'),
        join(projectDir, '.ralph-tui/config.yaml'),
      ];

  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return parseYaml(readFileSync(p, 'utf-8')) as StoredConfig;
      } catch {
        console.warn(`Warning: Could not parse config file: ${p}`);
      }
    }
  }
  return null;
}

/**
 * Load blueprint.json from project dir (or override path).
 */
export function loadBlueprintJson(projectDir: string, overridePath: string | null): Blueprint | null {
  const path = overridePath ?? join(projectDir, 'blueprint.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Blueprint;
  } catch {
    return null;
  }
}

/**
 * Initialize agent plugin instances from stored config.
 * Falls back to a single default 'claude' agent if config has no agents.
 */
export async function initializeAgentsFromConfig(
  storedConfig: StoredConfig | null,
): Promise<Record<string, AgentPlugin>> {
  registerBuiltinAgents();
  const registry = getAgentRegistry();
  const agentsMap: Record<string, AgentPlugin> = {};

  const agentConfigs = storedConfig?.agents ?? [];

  if (agentConfigs.length === 0) {
    const defaultAgent = registry.createInstance('claude');
    if (defaultAgent) {
      await defaultAgent.initialize({ skipPermissions: true });
      agentsMap['claude'] = defaultAgent;
    }
    return agentsMap;
  }

  for (const agentCfg of agentConfigs) {
    const instance = registry.createInstance(agentCfg.plugin);
    if (!instance) {
      console.warn(
        `Warning: Agent plugin "${agentCfg.plugin}" not found, skipping "${agentCfg.name}"`,
      );
      continue;
    }
    await instance.initialize({
      model: agentCfg.options?.['model'] as string | undefined,
      command: agentCfg.command,
      skipPermissions: true,
    });
    agentsMap[agentCfg.name] = instance;
  }

  return agentsMap;
}

/**
 * Build EvolutionConfig from parsed args, stored config, and agent instances.
 */
export function buildEvolutionConfig(
  parsedArgs: EvolveArgs,
  storedConfig: StoredConfig | null,
  agentsMap: Record<string, AgentPlugin>,
): EvolutionConfig {
  const routing = storedConfig?.evolutionRouting?.routing ?? {};

  const architectAgentName =
    routing['complexity:architecture'] ??
    routing['complexity:review'] ??
    storedConfig?.defaultAgent ??
    Object.keys(agentsMap)[0]!;

  const architectAgent = agentsMap[architectAgentName] ?? Object.values(agentsMap)[0]!;

  return {
    blueprintPath: parsedArgs.blueprintPath ?? join(parsedArgs.projectDir, 'blueprint.json'),
    maxVersions: parsedArgs.maxVersions,
    variantsPerTask: parsedArgs.variantsPerTask,
    reportsDir: join(parsedArgs.projectDir, 'evolution', 'reports'),
    usageLogPath: join(parsedArgs.projectDir, 'evolution', 'usage-log.jsonl'),
    cwd: parsedArgs.projectDir,
    routing,
    defaultAgent: storedConfig?.defaultAgent ?? Object.keys(agentsMap)[0]!,
    agents: agentsMap,
    usageMethods: storedConfig?.evolutionRouting?.usageMethods,
    architectAgent,
    maxWorkers: parsedArgs.maxWorkers,
  };
}

// ── Subcommands ─────────────────────────────────────────────────────────────

/**
 * choraforge evolve --status [project-dir]
 * Prints the version history table from evolution/versions.json.
 */
async function executeEvolveStatusCommand(projectDir: string): Promise<void> {
  const registry = new VersionRegistry(projectDir);
  const versions = registry.getVersions();

  if (versions.length === 0) {
    console.log('No evolution versions recorded yet.');
    console.log('Run "choraforge evolve" to start the evolution engine.');
    return;
  }

  const bold = '\x1b[1m';
  const reset = '\x1b[0m';
  const green = '\x1b[32m';

  console.log(`${bold}Version  Tag      Score  Delta                     Duration${reset}`);
  console.log('─'.repeat(72));

  for (const v of versions) {
    const ver = `v${v.version}`.padEnd(8);
    const tag = v.gitTag.padEnd(8);
    const score = String(v.qualityScore).padEnd(6);
    const deltaStr =
      v.criteriaDelta.length > 0
        ? `${green}+${v.criteriaDelta.length} met${reset}`
        : '(none)';
    const deltaCol = deltaStr.padEnd(25);
    const dur = v.durationMs > 0 ? `${Math.round(v.durationMs / 1000)}s` : '-';
    console.log(`${ver} ${tag} ${score} ${deltaCol} ${dur}`);
  }

  console.log('');
  console.log(`Total: ${versions.length} version(s). Latest: v${registry.getLatestVersion()}`);
}

// ── Main command ───────────────────────────────────────────────────────────

/**
 * Execute the choraforge evolve command.
 */
export async function executeEvolveCommand(args: string[]): Promise<void> {
  const parsedArgs = parseEvolveArgs(args);

  if (parsedArgs.help) {
    printEvolveHelp();
    return;
  }

  if (parsedArgs.status) {
    await executeEvolveStatusCommand(parsedArgs.projectDir);
    return;
  }

  const { projectDir } = parsedArgs;

  // Load blueprint
  const blueprint = loadBlueprintJson(projectDir, parsedArgs.blueprintPath);
  if (!blueprint) {
    const expected = parsedArgs.blueprintPath ?? join(projectDir, 'blueprint.json');
    console.error(`Error: Blueprint not found: ${expected}`);
    console.error(
      'Run "choraforge blueprint init" then "choraforge blueprint add" to create one.',
    );
    process.exit(1);
  }

  // Load stored config
  const storedConfig = loadStoredConfigFromDir(projectDir, parsedArgs.configPath);

  // Initialize agents
  const agentsMap = await initializeAgentsFromConfig(storedConfig);

  if (Object.keys(agentsMap).length === 0) {
    console.error('Error: No agents could be initialized. Check your .choraforge.yaml.');
    process.exit(1);
  }

  // Build EvolutionConfig
  const evolutionConfig = buildEvolutionConfig(parsedArgs, storedConfig, agentsMap);

  console.log('ChoraForge Evolution Engine');
  console.log('─'.repeat(50));
  console.log(`Project:    ${projectDir}`);
  console.log(`Blueprint:  ${evolutionConfig.blueprintPath}`);
  console.log(
    `Criteria:   ${blueprint.criteria.length} total, ${blueprint.criteria.filter((c) => !c.met).length} unmet`,
  );
  console.log(`Agents:     ${Object.keys(agentsMap).join(', ')}`);
  console.log(`Max versions: ${parsedArgs.maxVersions}`);
  console.log('');

  // Create engine
  const engine = new EvolutionEngine(evolutionConfig);

  // Graceful Ctrl+C handler
  let stopping = false;
  const sigintHandler = () => {
    if (!stopping) {
      stopping = true;
      console.log('\nStopping evolution engine gracefully...');
      engine.stop();
    }
  };
  process.on('SIGINT', sigintHandler);

  // Track current version for events that don't carry it
  let currentVersion = 0;

  engine.on((event) => {
    switch (event.type) {
      case 'evolution:started':
        console.log(`Starting evolution (max ${event.maxVersions} versions)`);
        break;

      case 'evolution:version-started':
        currentVersion = event.version;
        console.log(`\n[v${event.version}] Gap analysis...`);
        break;

      case 'evolution:gap-analysis':
        console.log(`[v${currentVersion}] ${event.tasksGenerated} task(s) identified`);
        break;

      case 'evolution:variants-spawned':
        console.log(`[v${currentVersion}] Spawning ${event.count} variant(s) in parallel...`);
        break;

      case 'evolution:variant-scored': {
        const s = event.score;
        const mark = s.recommended ? '✓' : '✗';
        const addressed =
          s.criteriaAddressed.length > 0 ? s.criteriaAddressed.join(', ') : 'none';
        console.log(
          `  [${mark}] ${s.workerId}: score=${s.qualityScore}  criteria=${addressed}`,
        );
        break;
      }

      case 'evolution:variant-selected':
        console.log(
          `  → Selected ${event.score.workerId} (score: ${event.score.qualityScore})`,
        );
        break;

      case 'evolution:version-complete': {
        const r = event.report;
        const delta = r.criteriaDelta.length;
        const total = r.criteriaMetAfter.length;
        console.log(
          `[v${r.version}] Done: +${delta} criteria met (${total} total, ${Math.round(r.durationMs / 1000)}s)`,
        );
        if (r.criteriaDelta.length > 0) {
          console.log(`  ✓ ${r.criteriaDelta.join(', ')}`);
        }
        break;
      }

      case 'evolution:complete':
        console.log('');
        console.log('─'.repeat(50));
        console.log(`Evolution complete after ${event.totalVersions} version(s).`);
        console.log(`Reports: ${join(projectDir, 'evolution', 'reports')}`);
        break;

      case 'evolution:stopped':
        console.log(`Stopped: ${event.reason}`);
        break;

      case 'evolution:error':
        console.error(`Error: ${event.error}`);
        break;
    }
  });

  try {
    await engine.start();
  } catch (err) {
    console.error(`Evolution failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    process.off('SIGINT', sigintHandler);
  }
}
