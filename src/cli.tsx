#!/usr/bin/env bun
/**
 * ABOUTME: CLI entry point for the ChoraForge application.
 * Handles subcommands (plugins, run, etc.) and defaults to 'run' when no subcommand given.
 * Fork of ralph-tui with evolutionary multi-model capabilities.
 */

import {
  printTrackerPlugins,
  printAgentPlugins,
  printPluginsHelp,
  executeRunCommand,
  executeStatusCommand,
  executeResumeCommand,
  executeConfigCommand,
  executeSetupCommand,
  executeLogsCommand,
  executeTemplateCommand,
  executeCreatePrdCommand,
  executeConvertCommand,
  executeDocsCommand,
  executeDoctorCommand,
  executeInfoCommand,
  executeSkillsCommand,
  executeRemoteCommand,
  executeBlueprintCommand,
  executeEvolveCommand,
  executeAppCreateCommand,
  executeAppListCommand,
  executeAppStartCommand,
  executeAppStopCommand,
  executeAppStatusCommand,
  executeAppDestroyCommand,
  executeAppBlueprintCommand,
} from './commands/index.js';

/**
 * Show CLI help message.
 */
function printAppHelp(): void {
  console.log(`
choraforge app - App Management Commands

Usage: choraforge app <subcommand> [options]

Subcommands:
  create              Register a new app
  list                List all registered apps
  start               Launch evolution for an app
  stop                Stop a running app
  status              Show detailed status for an app
  destroy             Remove an app and its Docker cell
  blueprint           Start interactive blueprint dialogue for an app
  help               Show this help message

Create Options:
  --name, -n <name>    App name (required, unique)
  --repo, -r <url>      Git repository URL (required)
  --stack, -s <type>    Stack type: node, python, rust (default: node)
  --agent, -a <name>     Agent type: openclaw, claude (default: openclaw)

Destroy Options:
  --confirm           Must be set to confirm destruction (safety flag)

Start Options:
  --blueprint, -b <path> Blueprint file path (default: app's configured path)

Description:
  Manage apps in the ChoraForge platform. Apps are registered in
  ~/.config/meta-vibecoding/apps.json and each runs in its own Docker cell.

  Workflow:
  1. Create: Register app with repo URL and stack type
  2. Blueprint: Create interactive blueprint with AI
  3. Start: Launch evolution loop
  4. Status/Stop: Monitor and control running apps
  5. Destroy: Remove app and its Docker cell (requires --confirm)

Examples:
  choraforge app create --name myapp --repo https://github.com/user/repo
  choraforge app list
  choraforge app start myapp
  choraforge app status myapp
  choraforge app stop myapp
  choraforge app destroy myapp --confirm
  choraforge app blueprint myapp
`);
}

/**
 * Show CLI help message.
 */
function showHelp(): void {
  console.log(`
ChoraForge - Evolutionary Multi-Model AI Agent Orchestrator

Usage: choraforge [command] [options]

Commands:
  (none)              Start execution (same as 'run')
  blueprint [opts]    Co-author a project blueprint with AI
  evolve [options]    Run evolutionary multi-model development
  create-prd [opts]   Create a new PRD interactively (alias: prime)
  convert [options]   Convert PRD markdown to JSON format
  run [options]       Start execution
  resume [options]    Resume an interrupted session
  status [options]    Check session status (headless, for CI/scripts)
  remote [subcommand] Manage remote server configurations
  logs [options]      View/manage iteration output logs
  setup [options]     Run interactive project setup (alias: init)
  doctor [options]    Diagnose agent configuration issues
  config show         Display merged configuration
  template show       Display current prompt template
  template init       Copy default template for customization
  template install    Alias for template init
  skills list         List bundled skills
  skills install      Install skills to ~/.claude/skills/
  plugins agents      List available agent plugins
  plugins trackers    List available tracker plugins
  docs [section]      Open documentation in browser
  info [options]      Display system information for bug reports
  app create         Register a new app
  app list           List all registered apps
  app start          Launch evolution for an app
  app stop           Stop a running app
  app status         Show detailed status for an app
  app destroy        Remove an app and its Docker cell
  app blueprint       Start interactive blueprint dialogue for an app
  help, --help, -h    Show this help message
  version, --version, -v  Show version number

Run Options:
  --epic <id>         Epic ID for beads tracker
  --prd <path>        PRD file path (auto-switches to json tracker)
  --agent <name>      Override agent plugin (e.g., claude, opencode)
  --model <name>      Override model (e.g., opus, sonnet)
  --tracker <name>    Override tracker plugin (e.g., beads, beads-bv, json)
  --iterations <n>    Maximum iterations (0 = unlimited)
  --resume            Resume existing session (deprecated, use 'resume' command)
  --headless          Run without TUI (alias: --no-tui)
  --no-tui            Run without TUI, output structured logs to stdout
  --no-setup          Skip interactive setup even if no config exists
  --verify            Run agent preflight check before starting
  --notify            Force enable desktop notifications
  --no-notify         Force disable desktop notifications
  --sandbox           Enable sandboxing (auto mode)
  --sandbox=bwrap     Force Bubblewrap sandboxing (Linux)
  --sandbox=sandbox-exec  Force sandbox-exec (macOS)
  --no-sandbox        Disable sandboxing
  --no-network        Disable network access in sandbox
  --listen            Enable remote listener (WebSocket server)
  --listen-port <n>   Port for remote listener (default: 7890)
  --rotate-token      Rotate server token before starting listener

Resume Options:
  --cwd <path>        Working directory
  --headless          Run without TUI
  --force             Override stale lock

Status Options:
  --json              Output in JSON format for CI/scripts
  --cwd <path>        Working directory

Convert Options:
  --to <format>       Target format: json
  --output, -o <path> Output file path (default: ./prd.json)
  --branch, -b <name> Git branch name (prompts if not provided)
  --force, -f         Overwrite existing files

Examples:
  choraforge                              # Start execution (same as 'run')
  choraforge create-prd                   # Create a new PRD interactively
  choraforge create-prd --chat            # Create PRD with AI chat mode
  choraforge convert --to json ./prd.md   # Convert PRD to JSON
  choraforge run                          # Start execution with defaults
  choraforge run --epic myproject-epic    # Run with specific epic
  choraforge run --prd ./prd.json         # Run with PRD file
  choraforge resume                       # Resume interrupted session
  choraforge status                       # Check session status
  choraforge status --json                # JSON output for CI/scripts
  choraforge logs                         # List iteration logs
  choraforge logs --iteration 5           # View specific iteration
  choraforge logs --task US-005           # View logs for a task
  choraforge logs --clean --keep 10       # Clean up old logs
  choraforge plugins agents               # List agent plugins
  choraforge plugins trackers             # List tracker plugins
  choraforge template show                # Show current prompt template
  choraforge template init                # Create custom template
  choraforge doctor                       # Check if agent is properly configured
  choraforge doctor --json                # JSON output for scripts
  choraforge docs                         # Open documentation in browser
  choraforge docs quickstart              # Open quick start guide
  choraforge info                         # Display system info for bug reports
  choraforge info -c                      # Copyable format for GitHub issues
  choraforge skills list                  # List bundled skills
  choraforge skills install --force       # Force reinstall all skills
  choraforge run --listen                 # Run with remote listener enabled
  choraforge run --listen --rotate-token  # Rotate token and start listener
  choraforge remote add prod server:7890 --token abc  # Add remote
  choraforge remote list                  # List remotes with status
  choraforge remote test prod             # Test connectivity
  choraforge app create --name myapp --repo https://github.com/user/repo
  choraforge app list
  choraforge app start myapp
  choraforge app status myapp
  choraforge app stop myapp
  choraforge app destroy myapp --confirm
  choraforge app blueprint myapp
`);
}

/**
 * Handle subcommands before launching TUI.
 * @returns true if a subcommand was handled and we should exit
 */
async function handleSubcommand(args: string[]): Promise<boolean> {
  const command = args[0];

  // Version command
  if (command === 'version' || command === '--version' || command === '-v') {
    // Dynamic import to get version from package.json
    const pkg = await import('../package.json', { with: { type: 'json' } });
    console.log(`choraforge ${pkg.default.version}`);
    return true;
  }

  // Help command
  if (command === 'help' || command === '--help' || command === '-h') {
    showHelp();
    return true;
  }

  // Blueprint command (ChoraForge-specific)
  if (command === 'blueprint') {
    await executeBlueprintCommand(args.slice(1));
    return true;
  }

  // Evolve command (ChoraForge-specific)
  if (command === 'evolve') {
    await executeEvolveCommand(args.slice(1));
    return true;
  }

  // Create-PRD command (with alias: prime)
  if (command === 'create-prd' || command === 'prime') {
    await executeCreatePrdCommand(args.slice(1));
    return true;
  }

  // Init command (alias for setup)
  if (command === 'init') {
    await executeSetupCommand(args.slice(1));
    return true;
  }

  // Convert command
  if (command === 'convert') {
    await executeConvertCommand(args.slice(1));
    return true;
  }

  // Run command
  if (command === 'run') {
    await executeRunCommand(args.slice(1));
    return true;
  }

  // Resume command
  if (command === 'resume') {
    await executeResumeCommand(args.slice(1));
    return true;
  }

  // Status command
  if (command === 'status') {
    await executeStatusCommand(args.slice(1));
    return true;
  }

  // Logs command
  if (command === 'logs') {
    await executeLogsCommand(args.slice(1));
    return true;
  }

  // Config command
  if (command === 'config') {
    await executeConfigCommand(args.slice(1));
    return true;
  }

  // Setup command
  if (command === 'setup') {
    await executeSetupCommand(args.slice(1));
    return true;
  }

  // Template command
  if (command === 'template') {
    await executeTemplateCommand(args.slice(1));
    return true;
  }

  // Docs command
  if (command === 'docs') {
    await executeDocsCommand(args.slice(1));
    return true;
  }

  // Doctor command
  if (command === 'doctor') {
    await executeDoctorCommand(args.slice(1));
    return true;
  }

  // Info command
  if (command === 'info') {
    await executeInfoCommand(args.slice(1));
    return true;
  }

  // Skills command
  if (command === 'skills') {
    await executeSkillsCommand(args.slice(1));
    return true;
  }

  // Remote command (manage remote configurations)
  if (command === 'remote') {
    await executeRemoteCommand(args.slice(1));
    return true;
  }

  // App command (US-13: App Management)
  if (command === 'app') {
    const subcommand = args[1];

    if (!subcommand || subcommand === '--help' || subcommand === '-h') {
      printAppHelp();
      return true;
    }

    if (subcommand === 'create') {
      await executeAppCreateCommand(args.slice(2));
      return true;
    }

    if (subcommand === 'list') {
      await executeAppListCommand();
      return true;
    }

    if (subcommand === 'start') {
      await executeAppStartCommand(args.slice(2));
      return true;
    }

    if (subcommand === 'stop') {
      await executeAppStopCommand(args.slice(2));
      return true;
    }

    if (subcommand === 'status') {
      await executeAppStatusCommand(args.slice(2));
      return true;
    }

    if (subcommand === 'destroy') {
      await executeAppDestroyCommand(args.slice(2));
      return true;
    }

    if (subcommand === 'blueprint') {
      await executeAppBlueprintCommand(args.slice(2));
      return true;
    }

    // Unknown or missing app subcommand
    if (subcommand) {
      console.error(`Unknown app subcommand: ${subcommand}`);
    }
    printAppHelp();
    return true;
  }

  // Plugins commands
  if (command === 'plugins') {
    const subcommand = args[1];

    if (subcommand === '--help' || subcommand === '-h') {
      printPluginsHelp();
      return true;
    }

    if (subcommand === 'agents') {
      await printAgentPlugins();
      return true;
    }

    if (subcommand === 'trackers') {
      await printTrackerPlugins();
      return true;
    }

    // Unknown or missing plugins subcommand
    if (subcommand) {
      console.error(`Unknown plugins subcommand: ${subcommand}`);
    }
    printPluginsHelp();
    return true;
  }

  // Unknown command
  if (command && !command.startsWith('-')) {
    console.error(`Unknown command: ${command}`);
    showHelp();
    process.exit(1);
  }

  return false;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Get command-line arguments (skip node and script path)
  const args = process.argv.slice(2);

  // Handle subcommands
  const handled = await handleSubcommand(args);
  if (handled) {
    return;
  }

  // No subcommand - default to 'run' command
  await executeRunCommand(args);
}

// Run the main function
main().catch((error: unknown) => {
  console.error('Failed to start ChoraForge:', error);
  process.exit(1);
});
