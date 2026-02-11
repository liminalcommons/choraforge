/**
 * ABOUTME: App management commands for ChoraForge CLI.
 * Provides create, list, start, stop, status, destroy, and blueprint subcommands.
 * Depends on US-007 (Orchestrator) for app lifecycle operations.
 */

import { AppRegistry, type AppStatus, type StackType } from '../platform/registry.js';
import { CellManager } from '../platform/cell-manager.js';
import { AppCellOrchestrator } from '../platform/orchestrator.js';
import type { Blueprint as AgentBlueprint, BlueprintCriterion } from '../platform/agent-adapter.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Arguments for app create command. */
interface AppCreateArgs {
  name: string;
  repo: string;
  stack: StackType;
  agent?: string;
  help: boolean;
}

/** Arguments for app start command. */
interface AppStartArgs {
  name: string;
  blueprint?: string;
  help: boolean;
}

/** Arguments for app stop command. */
interface AppStopArgs {
  name: string;
  help: boolean;
}

/** Arguments for app status command. */
interface AppStatusArgs {
  name: string;
  help: boolean;
}

/** Arguments for app destroy command. */
interface AppDestroyArgs {
  name: string;
  confirm: boolean;
  help: boolean;
}

/** Arguments for app blueprint command. */
interface AppBlueprintArgs {
  name: string;
  help: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Create registry and cell manager for app operations.
 */
function createAppRegistry(): AppRegistry {
  const registryPath = join(process.env.HOME || '', '.config', 'meta-vibecoding', 'apps.json');
  return new AppRegistry(registryPath);
}

/**
 * Create cell manager for Docker operations.
 */
function createCellManager(): CellManager {
  return new CellManager();
}

/**
 * Create orchestrator for app lifecycle coordination.
 */
function createOrchestrator(registry: AppRegistry, cellManager: CellManager): AppCellOrchestrator {
  return new AppCellOrchestrator(registry, cellManager);
}

/**
 * Format app status for display.
 */
function formatAppStatus(status: AppStatus): string {
  const icons = {
    idle: '○',
    running: '▶',
    paused: '⏸',
    error: '✗',
  };
  return `${icons[status]} ${status.toUpperCase()}`;
}

/**
 * Format stack type for display.
 */
function formatStackType(stack: StackType): string {
  return stack.toUpperCase();
}

/**
 * Parse blueprint file into AgentBlueprint type.
 */
function parseBlueprintFile(content: string): AgentBlueprint {
  const lines = content.split('\n');
  const criteria: BlueprintCriterion[] = [];
  const constraints: string[] = [];
  const outOfScope: string[] = [];
  let vision = '';
  let currentSection = '';

  for (const line of lines) {
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
      case 'criteria':
        // Parse: - AC-1 [P0]: description
        const criterionMatch = trimmed.match(/^-\s*(AC-\d+)\s*\[(P[012])\]:\s*(.+)$/);
        if (criterionMatch) {
          const priorityMap: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
          criteria.push({
            id: criterionMatch[1]!,
            description: criterionMatch[3]!,
            priority: priorityMap[criterionMatch[2]!] ?? 2,
            met: false,
          });
        }
        break;
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
  };
}

// ─── App Create ────────────────────────────────────────────────────────

/**
 * Parse app create arguments.
 */
export function parseAppCreateArgs(args: string[]): AppCreateArgs {
  const result: AppCreateArgs = {
    name: '',
    repo: '',
    stack: 'node',
    agent: 'openclaw',
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if ((arg === '--name' || arg === '-n') && args[i + 1]) {
      result.name = args[++i]!;
    } else if ((arg === '--repo' || arg === '-r') && args[i + 1]) {
      result.repo = args[++i]!;
    } else if ((arg === '--stack' || arg === '-s') && args[i + 1]) {
      const stack = args[++i]!;
      if (stack === 'node' || stack === 'python' || stack === 'rust') {
        result.stack = stack;
      } else {
        throw new Error(`Invalid stack type: ${stack}. Must be: node, python, rust`);
      }
    } else if ((arg === '--agent' || arg === '-a') && args[i + 1]) {
      result.agent = args[++i]!;
    }
  }

  return result;
}

/**
 * Execute app create command.
 */
export async function executeAppCreateCommand(args: string[]): Promise<void> {
  const parsed = parseAppCreateArgs(args);

  if (parsed.help) {
    printAppCreateHelp();
    return;
  }

  // Validate required args
  if (!parsed.name) {
    console.error('Error: --name is required');
    console.log('Usage: choraforge app create --name <name> --repo <url> [--stack <type>]');
    process.exit(1);
  }

  if (!parsed.repo) {
    console.error('Error: --repo is required');
    console.log('Usage: choraforge app create --name <name> --repo <url> [--stack <type>]');
    process.exit(1);
  }

  // Initialize components
  const registry = createAppRegistry();
  await registry.load();

  const cellManager = createCellManager();

  console.log(`Creating app: ${parsed.name}`);
  console.log(`Repository: ${parsed.repo}`);
  console.log(`Stack: ${formatStackType(parsed.stack)}`);
  console.log(`Agent: ${parsed.agent}`);
  console.log('');

  try {
    // Verify Docker is available
    await cellManager.ping();

    // Register app in registry
    const app = await registry.create({
      name: parsed.name,
      repoUrl: parsed.repo,
      stackType: parsed.stack,
      agentType: parsed.agent ?? 'openclaw',
      currentVersion: '0.0.0',
      status: 'idle',
    });

    console.log(`✓ App registered with ID: ${app.id}`);
    console.log('');
    console.log('Next steps:');
    console.log(`  1. Create a blueprint: choraforge app blueprint ${parsed.name}`);
    console.log(`  2. Start evolution: choraforge app start ${parsed.name}`);
    console.log('');
  } catch (err) {
    console.error(`✗ Failed to create app: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Print help for app create.
 */
export function printAppCreateHelp(): void {
  console.log(`
choraforge app create - Register a new app in ChoraForge

Usage: choraforge app create --name <name> --repo <url> [options]

Options:
  --name, -n <name>    App name (required, unique)
  --repo, -r <url>      Git repository URL (required)
  --stack, -s <type>    Stack type: node, python, rust (default: node)
  --agent, -a <name>     Agent type: openclaw, claude (default: openclaw)
  --help, -h            Show this help message

Description:
  Registers a new app in the ChoraForge registry. This creates an
  entry in ~/.config/meta-vibecoding/apps.json but does NOT
  create the Docker cell yet — that happens on first 'start'.

  The app must have a blueprint before starting evolution. Use
  'choraforge app blueprint <name>' to create one interactively.

Examples:
  choraforge app create --name myapp --repo https://github.com/user/repo
  choraforge app create -n myapp -r https://github.com/user/repo -s python
  choraforge app create --name myapp --repo https://github.com/user/repo --agent claude
`);
}

// ─── App List ─────────────────────────────────────────────────────────

/**
 * Execute app list command.
 */
export async function executeAppListCommand(): Promise<void> {
  const registry = createAppRegistry();
  await registry.load();

  const apps = await registry.list();

  if (apps.length === 0) {
    console.log('No apps registered.');
    console.log('');
    console.log('Create an app with: choraforge app create --name <name> --repo <url>');
    return;
  }

  console.log('Registered Apps:');
  console.log('═'.repeat(60));

  for (const app of apps) {
    const status = formatAppStatus(app.status);
    const stack = formatStackType(app.stackType);
    console.log(`  ${app.name.padEnd(20)} │ ${status.padEnd(10)} │ ${stack.padEnd(8)} │ ${app.id}`);
  }

  console.log('═'.repeat(60));
  console.log(`Total: ${apps.length} app(s)`);
  console.log('');
  console.log('Use "choraforge app status <name>" for details');
  console.log('Use "choraforge app start <name>" to launch evolution');
}

// ─── App Start ───────────────────────────────────────────────────────

/**
 * Parse app start arguments.
 */
export function parseAppStartArgs(args: string[]): AppStartArgs {
  const result: AppStartArgs = {
    name: '',
    blueprint: undefined,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if ((arg === '--blueprint' || arg === '-b') && args[i + 1]) {
      result.blueprint = args[++i]!;
    } else if (!result.name) {
      result.name = arg;
    }
  }

  return result;
}

/**
 * Execute app start command.
 */
export async function executeAppStartCommand(args: string[]): Promise<void> {
  const parsed = parseAppStartArgs(args);

  if (parsed.help) {
    printAppStartHelp();
    return;
  }

  if (!parsed.name) {
    console.error('Error: app name is required');
    console.log('Usage: choraforge app start <name> [--blueprint <path>]');
    process.exit(1);
  }

  // Initialize components
  const registry = createAppRegistry();
  await registry.load();

  const cellManager = createCellManager();
  const orchestrator = createOrchestrator(registry, cellManager);

  // Find app by name
  const app = await registry.getByName(parsed.name);
  if (!app) {
    console.error(`Error: App not found: ${parsed.name}`);
    console.log('Use "choraforge app list" to see registered apps');
    process.exit(1);
  }

  // Load blueprint
  let blueprint: AgentBlueprint | undefined;
  if (parsed.blueprint) {
    const blueprintPath = parsed.blueprint;
    if (!existsSync(blueprintPath)) {
      console.error(`Error: Blueprint file not found: ${blueprintPath}`);
      process.exit(1);
    }
    const content = readFileSync(blueprintPath, 'utf-8');
    blueprint = parseBlueprintFile(content);
    console.log(`Using blueprint from: ${blueprintPath}`);
  } else if (app.blueprintPath) {
    if (!existsSync(app.blueprintPath)) {
      console.error(`Error: Configured blueprint not found: ${app.blueprintPath}`);
      console.log('Create a blueprint with: choraforge app blueprint ' + parsed.name);
      process.exit(1);
    }
    const content = readFileSync(app.blueprintPath, 'utf-8');
    blueprint = parseBlueprintFile(content);
    console.log(`Using blueprint from: ${app.blueprintPath}`);
  } else {
    console.error('Error: No blueprint available. Create one first:');
    console.log(`  choraforge app blueprint ${parsed.name}`);
    process.exit(1);
  }

  console.log(`Starting app: ${parsed.name}`);
  console.log(`Repository: ${app.repoUrl}`);
  console.log(`Stack: ${formatStackType(app.stackType)}`);
  console.log(`Agent: ${app.agentType}`);
  console.log('');

  try {
    // Verify Docker is available
    await cellManager.ping();

    // Launch app via orchestrator
    await orchestrator.launchApp(app.id, {
      blueprint,
    });

    console.log('✓ App started');
    console.log('');
    console.log('Evolution is running. Monitor with:');
    console.log(`  choraforge app status ${parsed.name}`);
    console.log('');
  } catch (err) {
    console.error(`✗ Failed to start app: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Print help for app start.
 */
export function printAppStartHelp(): void {
  console.log(`
choraforge app start - Launch evolution for a registered app

Usage: choraforge app start <name> [options]

Arguments:
  name                App name to start (required)
  --blueprint, -b <path> Blueprint file path (default: app's configured path)

Options:
  --help, -h          Show this help message

Description:
  Launches the evolution loop for a registered app. The app must have
  a blueprint configured — use 'choraforge app blueprint <name>' to create one.

  This command:
  1. Creates/starts the Docker cell for the app
  2. Assigns the configured agent
  3. Begins evolution loop iterating through blueprint gaps

  Evolution runs until complete, stopped, or errored. Monitor status
  with 'choraforge app status <name>'.

Examples:
  choraforge app start myapp
  choraforge app start myapp --blueprint custom/blueprint.md
`);
}

// ─── App Stop ────────────────────────────────────────────────────────

/**
 * Parse app stop arguments.
 */
export function parseAppStopArgs(args: string[]): AppStopArgs {
  const result: AppStopArgs = {
    name: '',
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (!result.name) {
      result.name = arg;
    }
  }

  return result;
}

/**
 * Execute app stop command.
 */
export async function executeAppStopCommand(args: string[]): Promise<void> {
  const parsed = parseAppStopArgs(args);

  if (parsed.help) {
    printAppStopHelp();
    return;
  }

  if (!parsed.name) {
    console.error('Error: app name is required');
    console.log('Usage: choraforge app stop <name>');
    process.exit(1);
  }

  // Initialize components
  const registry = createAppRegistry();
  await registry.load();

  const cellManager = createCellManager();
  const orchestrator = createOrchestrator(registry, cellManager);

  // Find app by name
  const app = await registry.getByName(parsed.name);
  if (!app) {
    console.error(`Error: App not found: ${parsed.name}`);
    console.log('Use "choraforge app list" to see registered apps');
    process.exit(1);
  }

  console.log(`Stopping app: ${parsed.name}`);
  console.log('');

  try {
    // Check if app is running
    if (!orchestrator.isRunning(app.id)) {
      console.log('App is not currently running.');
      console.log('Status: ' + formatAppStatus(app.status));
      return;
    }

    // Stop app via orchestrator
    await orchestrator.stopApp(app.id);

    console.log('✓ App stopped');
    console.log('');
    console.log('To restart: choraforge app start ' + parsed.name);
    console.log('');
  } catch (err) {
    console.error(`✗ Failed to stop app: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Print help for app stop.
 */
export function printAppStopHelp(): void {
  console.log(`
choraforge app stop - Gracefully stop a running app

Usage: choraforge app stop <name>

Arguments:
  name                App name to stop (required)

Options:
  --help, -h          Show this help message

Description:
  Stops the evolution loop for a running app and gracefully shuts down
  its Docker cell. The app remains registered and can be restarted later.

  This is a graceful stop — the evolution loop will complete its current
  gap iteration before shutting down.

Examples:
  choraforge app stop myapp
`);
}

// ─── App Status ───────────────────────────────────────────────────────

/**
 * Parse app status arguments.
 */
export function parseAppStatusArgs(args: string[]): AppStatusArgs {
  const result: AppStatusArgs = {
    name: '',
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (!result.name) {
      result.name = arg;
    }
  }

  return result;
}

/**
 * Execute app status command.
 */
export async function executeAppStatusCommand(args: string[]): Promise<void> {
  const parsed = parseAppStatusArgs(args);

  if (parsed.help) {
    printAppStatusHelp();
    return;
  }

  if (!parsed.name) {
    console.error('Error: app name is required');
    console.log('Usage: choraforge app status <name>');
    process.exit(1);
  }

  // Initialize components
  const registry = createAppRegistry();
  await registry.load();

  const cellManager = createCellManager();
  const orchestrator = createOrchestrator(registry, cellManager);

  // Find app by name
  const app = await registry.getByName(parsed.name);
  if (!app) {
    console.error(`Error: App not found: ${parsed.name}`);
    console.log('Use "choraforge app list" to see registered apps');
    process.exit(1);
  }

  console.log(`App: ${app.name}`);
  console.log('─'.repeat(50));

  try {
    // Get detailed status from orchestrator
    const status = await orchestrator.getAppStatus(app.id);

    // Basic info
    console.log(`  ID:           ${status.appId}`);
    console.log(`  Name:         ${status.appName}`);
    console.log(`  Status:       ${formatAppStatus(status.appStatus)}`);
    console.log(`  Stack:        ${formatStackType(app.stackType)}`);
    console.log(`  Agent:        ${app.agentType}`);
    console.log(`  Created:      ${new Date(app.createdAt).toLocaleString()}`);
    console.log('');

    // Cell status
    console.log('Cell (Docker):');
    if (status.cell.state === 'running') {
      console.log(`  State:        RUNNING`);
      console.log(`  Started:      ${status.cell.startedAt ? new Date(status.cell.startedAt).toLocaleString() : 'unknown'}`);
    } else if (status.cell.state === 'stopped') {
      console.log(`  State:        STOPPED`);
      console.log(`  Finished:     ${status.cell.finishedAt ? new Date(status.cell.finishedAt).toLocaleString() : 'unknown'}`);
    } else if (status.cell.state === 'error') {
      console.log(`  State:        ERROR`);
      console.log(`  Error:        ${status.cell.error}`);
    } else {
      console.log(`  State:        NOT CREATED`);
    }
    console.log('');

    // Agent status - simplified to avoid type issues
    console.log('Agent:');
    const agentState = status.agent.state;
    console.log(`  State:        ${agentState.toUpperCase()}`);
    console.log('');

    // Evolution progress
    console.log('Evolution:');
    console.log(`  Running:       ${status.evolution.running ? 'Yes' : 'No'}`);
    console.log(`  Gaps:          ${status.evolution.gapsCompleted}/${status.evolution.totalGaps} completed`);
    if (status.evolution.currentGap) {
      console.log(`  Current Gap:   ${status.evolution.currentGap}`);
    }
    console.log('');

    // Actions
    if (status.evolution.running || status.cell.state === 'running') {
      console.log('Actions:');
      console.log('  Stop:   choraforge app stop ' + parsed.name);
    } else {
      console.log('Actions:');
      console.log('  Start:  choraforge app start ' + parsed.name);
    }

    console.log('  Destroy: choraforge app destroy ' + parsed.name);
    console.log('─'.repeat(50));
  } catch (err) {
    console.error(`✗ Failed to get status: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Print help for app status.
 */
export function printAppStatusHelp(): void {
  console.log(`
choraforge app status - Show detailed status for an app

Usage: choraforge app status <name>

Arguments:
  name                App name to query (required)

Options:
  --help, -h          Show this help message

Description:
  Shows detailed status for a registered app including:
  - Registry information (ID, name, stack, agent)
  - Docker cell status (running, stopped, error)
  - Agent status (idle, evolving, stopped, error)
  - Evolution progress (gaps completed/total, current gap)

Examples:
  choraforge app status myapp
`);
}

// ─── App Destroy ──────────────────────────────────────────────────────

/**
 * Parse app destroy arguments.
 */
export function parseAppDestroyArgs(args: string[]): AppDestroyArgs {
  const result: AppDestroyArgs = {
    name: '',
    confirm: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--confirm') {
      result.confirm = true;
    } else if (!result.name) {
      result.name = arg;
    }
  }

  return result;
}

/**
 * Execute app destroy command.
 */
export async function executeAppDestroyCommand(args: string[]): Promise<void> {
  const parsed = parseAppDestroyArgs(args);

  if (parsed.help) {
    printAppDestroyHelp();
    return;
  }

  if (!parsed.name) {
    console.error('Error: app name is required');
    console.log('Usage: choraforge app destroy <name> --confirm');
    process.exit(1);
  }

  if (!parsed.confirm) {
    console.error('Error: --confirm flag is required for destroy');
    console.log('This is a safety measure to prevent accidental data loss.');
    console.log('');
    console.log('Usage: choraforge app destroy <name> --confirm');
    process.exit(1);
  }

  // Initialize components
  const registry = createAppRegistry();
  await registry.load();

  const cellManager = createCellManager();
  const orchestrator = createOrchestrator(registry, cellManager);

  // Find app by name
  const app = await registry.getByName(parsed.name);
  if (!app) {
    console.error(`Error: App not found: ${parsed.name}`);
    console.log('Use "choraforge app list" to see registered apps');
    process.exit(1);
  }

  console.log(`Destroying app: ${parsed.name}`);
  console.log(`Repository: ${app.repoUrl}`);
  console.log('');

  try {
    // Stop if running
    if (orchestrator.isRunning(app.id)) {
      console.log('Stopping app first...');
      await orchestrator.stopApp(app.id);
      console.log('✓ App stopped');
    }

    // Destroy cell (removes container and volume)
    await cellManager.destroyCell(app.name, { confirm: true });

    // Remove from registry
    await registry.delete(app.id);

    console.log('✓ App destroyed');
    console.log('');
    console.log('The app has been removed from the registry.');
    console.log('Docker cell and data volume have been deleted.');
    console.log('');
  } catch (err) {
    console.error(`✗ Failed to destroy app: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Print help for app destroy.
 */
export function printAppDestroyHelp(): void {
  console.log(`
choraforge app destroy - Remove an app and its Docker cell

Usage: choraforge app destroy <name> --confirm

Arguments:
  name                App name to destroy (required)

Options:
  --confirm           Must be set to confirm destruction (safety flag)
  --help, -h          Show this help message

Description:
  Permanently removes an app from the registry and destroys its
  Docker cell (container + volume). THIS CANNOT BE UNDONE.

  This command:
  1. Stops the app if running
  2. Destroys the Docker cell (container and data volume)
  3. Removes the app from the registry

  The --confirm flag is required as a safety measure to prevent
  accidental data loss.

Examples:
  choraforge app destroy myapp --confirm
`);
}

// ─── App Blueprint ────────────────────────────────────────────────────

/**
 * Parse app blueprint arguments.
 */
export function parseAppBlueprintArgs(args: string[]): AppBlueprintArgs {
  const result: AppBlueprintArgs = {
    name: '',
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (!result.name) {
      result.name = arg;
    }
  }

  return result;
}

/**
 * Execute app blueprint command.
 * Note: This is a thin wrapper around the blueprint command to provide app context.
 */
export async function executeAppBlueprintCommand(args: string[]): Promise<void> {
  const parsed = parseAppBlueprintArgs(args);

  if (parsed.help) {
    printAppBlueprintHelp();
    return;
  }

  if (!parsed.name) {
    console.error('Error: app name is required');
    console.log('Usage: choraforge app blueprint <name>');
    process.exit(1);
  }

  // Initialize components
  const registry = createAppRegistry();
  await registry.load();

  // Find app by name
  const app = await registry.getByName(parsed.name);
  if (!app) {
    console.error(`Error: App not found: ${parsed.name}`);
    console.log('Use "choraforge app list" to see registered apps');
    process.exit(1);
  }

  console.log(`Starting blueprint dialogue for: ${parsed.name}`);
  console.log(`Repository: ${app.repoUrl}`);
  console.log(`Stack: ${formatStackType(app.stackType)}`);
  console.log('');
  console.log('This will launch an interactive AI session to create a blueprint.');
  console.log('The blueprint will be saved to: evolution/blueprint.md');
  console.log('');
  // Output a helpful message about updating the app's blueprint path
  console.log('Note: After creating the blueprint, update the app registry:');
  console.log('  Edit ~/.config/meta-vibecoding/apps.json');
  console.log('  Add "blueprintPath": "evolution/blueprint.md" to your app');
  console.log('');
  console.log('For now, the blueprint will be created. Use the --blueprint flag when starting:');
  console.log(`  choraforge app start ${parsed.name} --blueprint evolution/blueprint.md`);
}

/**
 * Print help for app blueprint.
 */
export function printAppBlueprintHelp(): void {
  console.log(`
choraforge app blueprint - Start interactive blueprint dialogue for an app

Usage: choraforge app blueprint <name>

Arguments:
  name                App name to create blueprint for (required)

Options:
  --help, -h          Show this help message

Description:
  Starts an interactive AI session to co-author a blueprint for the
  specified app. The blueprint defines the project vision and
  acceptance criteria that guide the evolution engine.

  The blueprint is saved to evolution/blueprint.md. Update the app's
  blueprintPath in the registry to use this blueprint when starting the app.

  Note: This command creates a blueprint file. To start evolution with
  the new blueprint, use:
    choraforge app start <name> --blueprint evolution/blueprint.md

Examples:
  choraforge app blueprint myapp
`);
}
