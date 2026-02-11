/**
 * ABOUTME: Kimi K2 agent plugin for Moonshot AI's kimi CLI.
 * Integrates with the Kimi Code CLI for AI-assisted coding.
 * Supports: stdin prompt input, model selection, work directory, verbose output.
 */

import { spawn } from 'node:child_process';
import { BaseAgentPlugin, findCommandPath, quoteForWindowsShell } from '../base.js';
import type {
  AgentPluginMeta,
  AgentPluginFactory,
  AgentFileContext,
  AgentExecuteOptions,
  AgentSetupQuestion,
  AgentDetectResult,
} from '../types.js';

/**
 * Valid Kimi model names.
 * Empty string means use default model from kimi config.
 */
const VALID_KIMI_MODELS = ['', 'kimi-k2.5', 'kimi-k2', 'moonshot-v1-128k', 'moonshot-v1-32k'] as const;

/**
 * Kimi K2 agent plugin implementation.
 * Uses the `kimi` CLI to execute AI coding tasks.
 *
 * Key features:
 * - Auto-detects kimi binary using `which`/`where`
 * - Passes prompt via stdin for safe shell character handling
 * - Configurable model selection via --model flag
 * - Timeout handling with graceful SIGINT before SIGTERM
 * - Streaming stdout/stderr capture
 */
export class KimiK2AgentPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'kimi-k2',
    name: 'Kimi K2',
    description: 'Moonshot AI Kimi CLI for AI-assisted coding',
    version: '1.0.0',
    author: 'Moonshot AI',
    defaultCommand: 'kimi',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: false,
    supportsSubagentTracing: false, // Text output only
    structuredOutputFormat: undefined,
    skillsPaths: {
      personal: '~/.kimi/skills',
      repo: '.kimi/skills',
    },
  };

  private model?: string;
  protected override defaultTimeout = 0;

  override async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize(config);

    if (typeof config.model === 'string') {
      const model = config.model.trim();
      if (model && !this.validateModel(model)) {
        this.model = model;
      }
    }

    if (typeof config.timeout === 'number' && config.timeout > 0) {
      this.defaultTimeout = config.timeout;
    }
  }

  /**
   * Detect kimi CLI availability.
   * Uses platform-appropriate command (where on Windows, which on Unix).
   */
  override async detect(): Promise<AgentDetectResult> {
    const command = this.commandPath ?? this.meta.defaultCommand;
    const findResult = await findCommandPath(command);

    if (!findResult.found) {
      return {
        available: false,
        error: `Kimi CLI not found in PATH. Install with: pip install kimi-cli`,
      };
    }

    const versionResult = await this.runVersion(findResult.path);

    if (!versionResult.success) {
      return {
        available: false,
        executablePath: findResult.path,
        error: versionResult.error,
      };
    }

    this.commandPath = findResult.path;

    return {
      available: true,
      version: versionResult.version,
      executablePath: findResult.path,
    };
  }

  /**
   * Run --version to verify binary and extract version number.
   */
  private runVersion(
    command: string
  ): Promise<{ success: boolean; version?: string; error?: string }> {
    return new Promise((resolve) => {
      const useShell = process.platform === 'win32';
      const proc = spawn(useShell ? quoteForWindowsShell(command) : command, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: useShell,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        resolve({ success: false, error: `Failed to execute: ${error.message}` });
      });

      proc.on('close', (code) => {
        if (code === 0) {
          // kimi outputs "kimi, version X.Y" format
          const versionMatch = stdout.match(/(\d+\.\d+(?:\.\d+)?)/);
          resolve({ success: true, version: versionMatch?.[1] });
        } else {
          resolve({ success: false, error: stderr || `Exited with code ${code}` });
        }
      });

      setTimeout(() => {
        proc.kill();
        resolve({ success: false, error: 'Timeout waiting for --version' });
      }, 15000);
    });
  }

  override getSetupQuestions(): AgentSetupQuestion[] {
    return [
      ...super.getSetupQuestions(),
      {
        id: 'model',
        prompt: 'Model to use:',
        type: 'select',
        default: '',
        required: false,
        choices: [
          { value: '', label: 'Default', description: 'Use configured default model' },
          { value: 'kimi-k2.5', label: 'Kimi K2.5', description: 'Latest Kimi K2.5 model' },
          { value: 'kimi-k2', label: 'Kimi K2', description: 'Kimi K2 model' },
          { value: 'moonshot-v1-128k', label: 'Moonshot v1 128k', description: '128k context window' },
          { value: 'moonshot-v1-32k', label: 'Moonshot v1 32k', description: '32k context window' },
        ],
        help: 'Kimi model variant to use',
      },
    ];
  }

  protected buildArgs(
    _prompt: string,
    _files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): string[] {
    const args: string[] = [];

    // Model selection
    if (this.model) {
      args.push('--model', this.model);
    }

    // Set max ralph iterations to 0 for single-turn execution
    // (ralph-tui manages the outer loop)
    args.push('--max-ralph-iterations', '0');

    // Working directory (if specified in options)
    if (options?.cwd) {
      args.push('--work-dir', options.cwd);
    }

    // Prompt is passed via stdin (see getStdinInput)

    return args;
  }

  /**
   * Provide the prompt via stdin.
   * Kimi CLI reads from stdin when no interactive terminal is detected.
   */
  protected override getStdinInput(
    prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string {
    return prompt;
  }

  override async validateSetup(_answers: Record<string, unknown>): Promise<string | null> {
    return null;
  }

  override validateModel(model: string): string | null {
    if (model && !VALID_KIMI_MODELS.includes(model as typeof VALID_KIMI_MODELS[number])) {
      return `Invalid model "${model}". Kimi agent accepts: ${VALID_KIMI_MODELS.filter(m => m).join(', ')} (or empty for default)`;
    }
    return null;
  }

  protected override getPreflightSuggestion(): string {
    return (
      'Common fixes for Kimi CLI:\n' +
      '  1. Test Kimi directly: echo "hello" | kimi\n' +
      '  2. Verify your Moonshot API key: echo $MOONSHOT_API_KEY\n' +
      '  3. Check Kimi is installed: kimi --version\n' +
      '  4. Run setup: kimi login'
    );
  }
}

/**
 * Factory function for the Kimi K2 agent plugin.
 */
const createKimiK2Agent: AgentPluginFactory = () => new KimiK2AgentPlugin();

export default createKimiK2Agent;
