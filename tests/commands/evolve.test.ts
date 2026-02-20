/**
 * ABOUTME: Tests for the choraforge evolve command.
 * Covers arg parsing, config building, and event-stream output formatting.
 * Full E2E integration (real git worktrees + LLM calls) requires a separate
 * fixture-based test in tests/engine/.
 */

import { describe, it, expect } from 'bun:test';
import {
  parseEvolveArgs,
  loadBlueprintJson,
  loadStoredConfigFromDir,
  buildEvolutionConfig,
} from '../../src/commands/evolve.js';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Blueprint } from '../../src/commands/blueprint.js';
import type { AgentPlugin } from '../../src/plugins/agents/types.js';

// ── parseEvolveArgs ──────────────────────────────────────────────────────────

describe('parseEvolveArgs', () => {
  it('returns defaults when no args provided', () => {
    const args = parseEvolveArgs([]);
    expect(args.status).toBe(false);
    expect(args.maxVersions).toBe(10);
    expect(args.variantsPerTask).toBe(3);
    expect(args.maxWorkers).toBe(3);
    expect(args.blueprintPath).toBeNull();
    expect(args.configPath).toBeNull();
    expect(args.help).toBe(false);
  });

  it('parses --status flag', () => {
    const args = parseEvolveArgs(['--status']);
    expect(args.status).toBe(true);
  });

  it('parses --max-versions', () => {
    const args = parseEvolveArgs(['--max-versions', '5']);
    expect(args.maxVersions).toBe(5);
  });

  it('parses --variants', () => {
    const args = parseEvolveArgs(['--variants', '2']);
    expect(args.variantsPerTask).toBe(2);
  });

  it('parses --max-workers', () => {
    const args = parseEvolveArgs(['--max-workers', '4']);
    expect(args.maxWorkers).toBe(4);
  });

  it('parses positional project-dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cf-test-'));
    const args = parseEvolveArgs([dir]);
    expect(args.projectDir).toBe(dir);
  });

  it('parses --blueprint override', () => {
    const args = parseEvolveArgs(['--blueprint', '/custom/blueprint.json']);
    expect(args.blueprintPath).toBe('/custom/blueprint.json');
  });

  it('parses --help', () => {
    const args = parseEvolveArgs(['--help']);
    expect(args.help).toBe(true);
  });
});

// ── loadBlueprintJson ────────────────────────────────────────────────────────

describe('loadBlueprintJson', () => {
  it('returns null when blueprint.json does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cf-test-'));
    expect(loadBlueprintJson(dir, null)).toBeNull();
  });

  it('loads and parses a valid blueprint.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cf-test-'));
    const blueprint: Blueprint = {
      vision: 'Test vision',
      criteria: [{ id: 'AC-1', description: 'Test criterion', priority: 'P0', met: false }],
      constraints: ['No external deps'],
      outOfScope: ['Mobile app'],
      metadata: { createdAt: new Date().toISOString(), lastModified: new Date().toISOString(), version: 1 },
    };
    writeFileSync(join(dir, 'blueprint.json'), JSON.stringify(blueprint));
    const loaded = loadBlueprintJson(dir, null);
    expect(loaded).not.toBeNull();
    expect(loaded!.vision).toBe('Test vision');
    expect(loaded!.criteria).toHaveLength(1);
    expect(loaded!.criteria[0]!.id).toBe('AC-1');
  });

  it('loads from an override path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cf-test-'));
    const customPath = join(dir, 'custom-blueprint.json');
    const blueprint: Blueprint = {
      vision: 'Custom',
      criteria: [],
      constraints: [],
      outOfScope: [],
      metadata: { createdAt: '', lastModified: '', version: 1 },
    };
    writeFileSync(customPath, JSON.stringify(blueprint));
    const loaded = loadBlueprintJson(dir, customPath);
    expect(loaded).not.toBeNull();
    expect(loaded!.vision).toBe('Custom');
  });

  it('returns null for invalid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cf-test-'));
    writeFileSync(join(dir, 'blueprint.json'), 'not json {{{');
    expect(loadBlueprintJson(dir, null)).toBeNull();
  });
});

// ── loadStoredConfigFromDir ──────────────────────────────────────────────────

describe('loadStoredConfigFromDir', () => {
  it('returns null when no config file exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cf-test-'));
    expect(loadStoredConfigFromDir(dir, null)).toBeNull();
  });

  it('loads .choraforge.yaml', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cf-test-'));
    writeFileSync(join(dir, '.choraforge.yaml'), 'maxIterations: 5\ntracker: beads\n');
    const config = loadStoredConfigFromDir(dir, null);
    expect(config).not.toBeNull();
    expect(config!.maxIterations).toBe(5);
  });

  it('loads from an override path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cf-test-'));
    const configPath = join(dir, 'custom.yaml');
    writeFileSync(configPath, 'maxIterations: 20\n');
    const config = loadStoredConfigFromDir(dir, configPath);
    expect(config).not.toBeNull();
    expect(config!.maxIterations).toBe(20);
  });
});

// ── buildEvolutionConfig ─────────────────────────────────────────────────────

describe('buildEvolutionConfig', () => {
  const mockAgent = {} as AgentPlugin;

  it('builds config from minimal args and no stored config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cf-test-'));
    const parsedArgs = parseEvolveArgs([dir]);
    const config = buildEvolutionConfig(parsedArgs, null, { claude: mockAgent });

    expect(config.cwd).toBe(dir);
    expect(config.maxVersions).toBe(10);
    expect(config.variantsPerTask).toBe(3);
    expect(config.maxWorkers).toBe(3);
    expect(config.defaultAgent).toBe('claude');
    expect(config.architectAgent).toBe(mockAgent);
    expect(config.agents).toEqual({ claude: mockAgent });
    expect(config.routing).toEqual({});
    expect(config.usageMethods).toBeUndefined();
  });

  it('uses evolutionRouting.routing from stored config', () => {
    const parsedArgs = parseEvolveArgs(['/my/project']);
    const storedConfig = {
      evolutionRouting: {
        routing: { 'complexity:architecture': 'opus-agent', 'complexity:feature': 'kimi-agent' },
        usageMethods: { 'kimi-agent': 'always-available' as const },
      },
    };
    const agentsMap = { 'opus-agent': mockAgent, 'kimi-agent': {} as AgentPlugin };
    const config = buildEvolutionConfig(parsedArgs, storedConfig, agentsMap);

    expect(config.routing['complexity:architecture']).toBe('opus-agent');
    expect(config.architectAgent).toBe(mockAgent); // resolved from complexity:architecture
    expect(config.usageMethods).toEqual({ 'kimi-agent': 'always-available' });
  });

  it('overrides blueprintPath from args', () => {
    const parsedArgs = parseEvolveArgs(['/my/project', '--blueprint', '/custom/bp.json']);
    const config = buildEvolutionConfig(parsedArgs, null, { claude: mockAgent });
    expect(config.blueprintPath).toBe('/custom/bp.json');
  });

  it('defaults blueprintPath to <projectDir>/blueprint.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cf-test-'));
    const parsedArgs = parseEvolveArgs([dir]);
    const config = buildEvolutionConfig(parsedArgs, null, { claude: mockAgent });
    expect(config.blueprintPath).toBe(join(dir, 'blueprint.json'));
  });
});
