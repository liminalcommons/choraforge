/**
 * ABOUTME: Commands module for ChoraForge CLI commands.
 * Exports all CLI command handlers for the ChoraForge application.
 */

export {
  listTrackerPlugins,
  printTrackerPlugins,
  listAgentPlugins,
  printAgentPlugins,
  printPluginsHelp,
} from './plugins.js';

export {
  executeRunCommand,
  parseRunArgs,
  printRunHelp,
} from './run.jsx';

export {
  executeStatusCommand,
  printStatusHelp,
} from './status.js';

export {
  executeResumeCommand,
  parseResumeArgs,
  printResumeHelp,
} from './resume.jsx';

export {
  executeConfigCommand,
  executeConfigShowCommand,
  printConfigHelp,
} from './config.js';

export {
  executeSetupCommand,
  parseSetupArgs,
  printSetupHelp,
} from './setup.js';

export {
  executeLogsCommand,
  parseLogsArgs,
  printLogsHelp,
} from './logs.js';

export {
  executeTemplateCommand,
  printTemplateHelp,
} from './template.js';

export {
  executeCreatePrdCommand,
  parseCreatePrdArgs,
  printCreatePrdHelp,
} from './create-prd.jsx';

export {
  executeConvertCommand,
  parseConvertArgs,
  printConvertHelp,
} from './convert.js';

export {
  executeDocsCommand,
  parseDocsArgs,
  printDocsHelp,
} from './docs.js';

export {
  executeDoctorCommand,
  printDoctorHelp,
} from './doctor.js';

export {
  executeInfoCommand,
  collectSystemInfo,
  formatSystemInfo,
  formatForBugReport,
} from './info.js';

export {
  executeSkillsCommand,
  printSkillsHelp,
} from './skills.js';

export {
  executeListenCommand,
  parseListenArgs,
  printListenHelp,
} from './listen.js';

export {
  executeRemoteCommand,
  parseRemoteArgs,
  printRemoteHelp,
} from './remote.js';

export {
  executeBlueprintCommand,
  parseBlueprintArgs,
  printBlueprintHelp,
} from './blueprint.js';

export {
  executeBlueprintInitCommand,
  executeBlueprintAddCommand,
  executeBlueprintListCommand,
  executeBlueprintStatusCommand,
} from './blueprint-coauthor.js';

export {
  executeEvolveCommand,
  parseEvolveArgs,
  printEvolveHelp,
  loadStoredConfigFromDir,
  loadBlueprintJson,
  initializeAgentsFromConfig,
  buildEvolutionConfig,
} from './evolve.js';

export {
  executeEvolveCommand,
} from './evolve.js';

export {
  executeAppCreateCommand,
  parseAppCreateArgs,
  printAppCreateHelp,
  executeAppListCommand,
  executeAppStartCommand,
  parseAppStartArgs,
  printAppStartHelp,
  executeAppStopCommand,
  parseAppStopArgs,
  printAppStopHelp,
  executeAppStatusCommand,
  parseAppStatusArgs,
  printAppStatusHelp,
  executeAppDestroyCommand,
  parseAppDestroyArgs,
  printAppDestroyHelp,
  executeAppBlueprintCommand,
  parseAppBlueprintArgs,
  printAppBlueprintHelp,
} from './app.js';
