/**
 * ABOUTME: Tests for the KimiK2AgentPlugin.
 * Tests metadata, initialization, setup questions, and protected methods.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { KimiK2AgentPlugin } from '../../src/plugins/agents/builtin/kimi-k2.js';
import type {
  AgentFileContext,
  AgentExecuteOptions,
} from '../../src/plugins/agents/types.js';

/**
 * Test subclass to expose protected methods for testing.
 */
class TestableKimiK2Plugin extends KimiK2AgentPlugin {
  testBuildArgs(
    prompt: string,
    files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): string[] {
    return this['buildArgs'](prompt, files, options);
  }

  testGetStdinInput(
    prompt: string,
    files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): string {
    return this['getStdinInput'](prompt, files, options);
  }
}

describe('KimiK2AgentPlugin', () => {
  let plugin: KimiK2AgentPlugin;

  beforeEach(() => {
    plugin = new KimiK2AgentPlugin();
  });

  afterEach(async () => {
    try {
      if (await plugin.isReady()) {
        await plugin.dispose();
      }
    } catch {
      // Ignore errors from already-disposed plugin
    }
  });

  describe('metadata', () => {
    test('has correct plugin ID', () => {
      expect(plugin.meta.id).toBe('kimi-k2');
    });

    test('has correct name', () => {
      expect(plugin.meta.name).toBe('Kimi K2');
    });

    test('has correct default command', () => {
      expect(plugin.meta.defaultCommand).toBe('kimi');
    });

    test('supports streaming', () => {
      expect(plugin.meta.supportsStreaming).toBe(true);
    });

    test('supports interruption', () => {
      expect(plugin.meta.supportsInterrupt).toBe(true);
    });

    test('does not support file context', () => {
      expect(plugin.meta.supportsFileContext).toBe(false);
    });

    test('does not support subagent tracing', () => {
      expect(plugin.meta.supportsSubagentTracing).toBe(false);
    });

    test('has no structured output format', () => {
      expect(plugin.meta.structuredOutputFormat).toBeUndefined();
    });

    test('has correct skillsPaths', () => {
      expect(plugin.meta.skillsPaths).toBeDefined();
      expect(plugin.meta.skillsPaths?.personal).toBe('~/.kimi/skills');
      expect(plugin.meta.skillsPaths?.repo).toBe('.kimi/skills');
    });
  });

  describe('initialization', () => {
    test('initializes with default config', async () => {
      await plugin.initialize({});
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts model config', async () => {
      await plugin.initialize({ model: 'kimi-k2.5' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts timeout config', async () => {
      await plugin.initialize({ timeout: 120000 });
      expect(await plugin.isReady()).toBe(true);
    });

    test('ignores non-string model', async () => {
      await plugin.initialize({ model: 123 });
      expect(await plugin.isReady()).toBe(true);
    });

    test('ignores empty model string', async () => {
      await plugin.initialize({ model: '' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('ignores non-number timeout', async () => {
      await plugin.initialize({ timeout: '60000' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('ignores zero timeout', async () => {
      await plugin.initialize({ timeout: 0 });
      expect(await plugin.isReady()).toBe(true);
    });
  });

  describe('validateModel', () => {
    test('accepts empty string (default model)', () => {
      expect(plugin.validateModel('')).toBeNull();
    });

    test('accepts valid Kimi models', () => {
      expect(plugin.validateModel('kimi-k2.5')).toBeNull();
      expect(plugin.validateModel('kimi-k2')).toBeNull();
      expect(plugin.validateModel('moonshot-v1-128k')).toBeNull();
      expect(plugin.validateModel('moonshot-v1-32k')).toBeNull();
    });

    test('rejects invalid model names', () => {
      expect(plugin.validateModel('gpt-4')).toContain('Invalid model');
      expect(plugin.validateModel('claude-opus')).toContain('Invalid model');
      expect(plugin.validateModel('auto')).toContain('Invalid model');
    });
  });

  describe('validateSetup', () => {
    test('always returns null', async () => {
      const result = await plugin.validateSetup({});
      expect(result).toBeNull();
    });

    test('returns null with any answers', async () => {
      const result = await plugin.validateSetup({ model: 'kimi-k2.5' });
      expect(result).toBeNull();
    });
  });

  describe('setup questions', () => {
    test('includes model question', () => {
      const questions = plugin.getSetupQuestions();
      const modelQuestion = questions.find(q => q.id === 'model');
      expect(modelQuestion).toBeDefined();
      expect(modelQuestion?.type).toBe('select');
    });

    test('model question has correct choices', () => {
      const questions = plugin.getSetupQuestions();
      const modelQuestion = questions.find(q => q.id === 'model');
      expect(modelQuestion?.choices).toBeDefined();
      expect(modelQuestion?.choices?.length).toBe(5);

      const values = modelQuestion?.choices?.map(c => c.value);
      expect(values).toContain('');
      expect(values).toContain('kimi-k2.5');
      expect(values).toContain('kimi-k2');
      expect(values).toContain('moonshot-v1-128k');
      expect(values).toContain('moonshot-v1-32k');
    });
  });

  describe('buildArgs', () => {
    let testablePlugin: TestableKimiK2Plugin;

    beforeEach(async () => {
      testablePlugin = new TestableKimiK2Plugin();
      await testablePlugin.initialize({});
    });

    afterEach(async () => {
      await testablePlugin.dispose();
    });

    test('does NOT include prompt in args (passed via stdin)', () => {
      const prompt = 'Implement feature X';
      const args = testablePlugin.testBuildArgs(prompt);
      expect(args).not.toContain(prompt);
    });

    test('includes --max-ralph-iterations 0', () => {
      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args).toContain('--max-ralph-iterations');
      expect(args).toContain('0');
    });

    test('includes --model when model is configured', async () => {
      await testablePlugin.dispose();
      testablePlugin = new TestableKimiK2Plugin();
      await testablePlugin.initialize({ model: 'kimi-k2.5' });

      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args).toContain('--model');
      expect(args).toContain('kimi-k2.5');
    });

    test('excludes --model when not configured', () => {
      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args).not.toContain('--model');
    });

    test('includes --work-dir when cwd option provided', () => {
      const args = testablePlugin.testBuildArgs('test prompt', undefined, {
        cwd: '/tmp/test',
      } as AgentExecuteOptions);
      expect(args).toContain('--work-dir');
      expect(args).toContain('/tmp/test');
    });

    test('excludes --work-dir when no cwd option', () => {
      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args).not.toContain('--work-dir');
    });

    test('does not include special characters from prompt in args', () => {
      const prompt = 'feature with & special | characters > test "quoted"';
      const args = testablePlugin.testBuildArgs(prompt);
      for (const arg of args) {
        expect(arg).not.toContain('&');
        expect(arg).not.toContain('|');
        expect(arg).not.toContain('>');
      }
    });
  });

  describe('getStdinInput', () => {
    let testablePlugin: TestableKimiK2Plugin;

    beforeEach(async () => {
      testablePlugin = new TestableKimiK2Plugin();
      await testablePlugin.initialize({});
    });

    afterEach(async () => {
      await testablePlugin.dispose();
    });

    test('returns the prompt for stdin', () => {
      const prompt = 'Hello world';
      expect(testablePlugin.testGetStdinInput(prompt)).toBe(prompt);
    });

    test('returns prompt with special characters unchanged', () => {
      const prompt = 'feature with & special | characters > test "quoted"';
      expect(testablePlugin.testGetStdinInput(prompt)).toBe(prompt);
    });

    test('returns prompt with newlines', () => {
      const prompt = 'Line 1\nLine 2\nLine 3';
      expect(testablePlugin.testGetStdinInput(prompt)).toBe(prompt);
    });

    test('returns prompt with unicode characters', () => {
      const prompt = 'Hello 世界 🌍 émojis';
      expect(testablePlugin.testGetStdinInput(prompt)).toBe(prompt);
    });
  });
});
