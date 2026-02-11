/**
 * ABOUTME: Unit tests for the Agent Adapter interface, config, and factory.
 * Validates the pluggable agent contract for the Meta-Vibecoding platform.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import type {
  AgentAdapter,
  AgentAdapterConfig,
  AgentAdapterStatus,
  Blueprint,
  BlueprintCriterion,
  CellRef,
  EvolutionGap,
  EvolutionResult,
} from './agent-adapter.js';
import {
  AgentAdapterConfigSchema,
  registerAgentAdapter,
  createAgentAdapter,
  getRegisteredAgentTypes,
  hasAgentType,
  clearAgentAdapterRegistry,
} from './agent-adapter.js';

// ─── Test Fixtures ───────────────────────────────────────────────────────────

function makeCell(overrides?: Partial<CellRef>): CellRef {
  return {
    cellId: 'cell-001',
    workDir: '/workspace/app',
    stackType: 'node',
    ...overrides,
  };
}

function makeCriterion(overrides?: Partial<BlueprintCriterion>): BlueprintCriterion {
  return {
    id: 'crit-001',
    description: 'App has a landing page',
    met: false,
    priority: 1,
    ...overrides,
  };
}

function makeBlueprint(overrides?: Partial<Blueprint>): Blueprint {
  return {
    vision: 'A simple landing page app',
    criteria: [makeCriterion()],
    constraints: ['Must use vanilla HTML/CSS'],
    outOfScope: ['Backend API'],
    ...overrides,
  };
}

function makeGap(overrides?: Partial<EvolutionGap>): EvolutionGap {
  return {
    criterionId: 'crit-001',
    description: 'Landing page does not exist yet',
    priority: 1,
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<AgentAdapterConfig>): AgentAdapterConfig {
  return {
    agentType: 'mock',
    config: {},
    toolPreferences: {
      primary: 'ralph',
      fallbacks: [],
    },
    ...overrides,
  };
}

/**
 * Mock agent adapter for testing the factory and interface contract.
 */
class MockAgentAdapter implements AgentAdapter {
  public initialized = false;
  public stopped = false;
  public blueprintUpdates: Blueprint[] = [];
  public evolvedGaps: EvolutionGap[] = [];
  private _status: AgentAdapterStatus = { state: 'idle' };
  public config: AgentAdapterConfig;

  constructor(config: AgentAdapterConfig) {
    this.config = config;
  }

  async initialize(_cell: CellRef, _blueprint: Blueprint): Promise<void> {
    this.initialized = true;
    this._status = { state: 'idle' };
  }

  async evolve(gap: EvolutionGap): Promise<EvolutionResult> {
    this.evolvedGaps.push(gap);
    this._status = { state: 'evolving', currentTask: gap.description, criterionId: gap.criterionId };
    return {
      success: true,
      criterionId: gap.criterionId,
      summary: `Addressed: ${gap.description}`,
      filesChanged: ['index.html'],
      criterionMet: true,
    };
  }

  status(): AgentAdapterStatus {
    return this._status;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this._status = { state: 'stopped', reason: 'User requested stop' };
  }

  async onBlueprintUpdate(blueprint: Blueprint): Promise<void> {
    this.blueprintUpdates.push(blueprint);
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AgentAdapterConfigSchema', () => {
  test('validates a correct config', () => {
    const config = makeConfig();
    const result = AgentAdapterConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  test('rejects empty agentType', () => {
    const result = AgentAdapterConfigSchema.safeParse({
      agentType: '',
      config: {},
      toolPreferences: { primary: 'ralph', fallbacks: [] },
    });
    expect(result.success).toBe(false);
  });

  test('rejects empty primary tool', () => {
    const result = AgentAdapterConfigSchema.safeParse({
      agentType: 'openclaw',
      config: {},
      toolPreferences: { primary: '', fallbacks: [] },
    });
    expect(result.success).toBe(false);
  });

  test('defaults config to empty record', () => {
    const result = AgentAdapterConfigSchema.parse({
      agentType: 'openclaw',
      toolPreferences: { primary: 'ralph', fallbacks: [] },
    });
    expect(result.config).toEqual({});
  });

  test('defaults fallbacks to empty array', () => {
    const result = AgentAdapterConfigSchema.parse({
      agentType: 'openclaw',
      config: {},
      toolPreferences: { primary: 'ralph' },
    });
    expect(result.toolPreferences.fallbacks).toEqual([]);
  });

  test('accepts config with extra fields', () => {
    const result = AgentAdapterConfigSchema.safeParse({
      agentType: 'openclaw',
      config: { model: 'opus-4.6', temperature: 0.7 },
      toolPreferences: { primary: 'ralph', fallbacks: ['claude-code'] },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.config).toEqual({ model: 'opus-4.6', temperature: 0.7 });
    }
  });

  test('rejects empty fallback strings', () => {
    const result = AgentAdapterConfigSchema.safeParse({
      agentType: 'openclaw',
      config: {},
      toolPreferences: { primary: 'ralph', fallbacks: [''] },
    });
    expect(result.success).toBe(false);
  });
});

describe('AgentAdapter interface (via MockAgentAdapter)', () => {
  let adapter: MockAgentAdapter;

  beforeEach(() => {
    adapter = new MockAgentAdapter(makeConfig());
  });

  test('initialize sets up the agent', async () => {
    expect(adapter.initialized).toBe(false);
    await adapter.initialize(makeCell(), makeBlueprint());
    expect(adapter.initialized).toBe(true);
  });

  test('status returns idle before evolution', () => {
    const s = adapter.status();
    expect(s.state).toBe('idle');
  });

  test('evolve processes a gap and returns result', async () => {
    const gap = makeGap();
    const result = await adapter.evolve(gap);

    expect(result.success).toBe(true);
    expect(result.criterionId).toBe('crit-001');
    expect(result.criterionMet).toBe(true);
    expect(result.filesChanged).toContain('index.html');
    expect(adapter.evolvedGaps).toHaveLength(1);
  });

  test('status reflects evolving state after evolve', async () => {
    await adapter.evolve(makeGap());
    const s = adapter.status();
    expect(s.state).toBe('evolving');
    if (s.state === 'evolving') {
      expect(s.criterionId).toBe('crit-001');
    }
  });

  test('stop sets stopped state', async () => {
    await adapter.stop();
    expect(adapter.stopped).toBe(true);
    const s = adapter.status();
    expect(s.state).toBe('stopped');
    if (s.state === 'stopped') {
      expect(s.reason).toBe('User requested stop');
    }
  });

  test('onBlueprintUpdate records the update', async () => {
    const updated = makeBlueprint({ vision: 'Updated vision' });
    await adapter.onBlueprintUpdate(updated);
    expect(adapter.blueprintUpdates).toHaveLength(1);
    expect(adapter.blueprintUpdates[0].vision).toBe('Updated vision');
  });

  test('multiple evolve calls accumulate', async () => {
    await adapter.evolve(makeGap({ criterionId: 'crit-001' }));
    await adapter.evolve(makeGap({ criterionId: 'crit-002', description: 'Add footer' }));
    expect(adapter.evolvedGaps).toHaveLength(2);
    expect(adapter.evolvedGaps[1].criterionId).toBe('crit-002');
  });
});

describe('AgentAdapterFactory', () => {
  beforeEach(() => {
    clearAgentAdapterRegistry();
  });

  test('registerAgentAdapter and createAgentAdapter work together', () => {
    registerAgentAdapter('mock', (config) => new MockAgentAdapter(config));

    const adapter = createAgentAdapter(makeConfig({ agentType: 'mock' }));
    expect(adapter).toBeDefined();
    expect(adapter.status().state).toBe('idle');
  });

  test('createAgentAdapter throws for unknown type', () => {
    expect(() => createAgentAdapter(makeConfig({ agentType: 'nonexistent' }))).toThrow(
      "Unknown agent type: 'nonexistent'"
    );
  });

  test('createAgentAdapter error message lists registered types', () => {
    registerAgentAdapter('alpha', (config) => new MockAgentAdapter(config));
    registerAgentAdapter('beta', (config) => new MockAgentAdapter(config));

    try {
      createAgentAdapter(makeConfig({ agentType: 'gamma' }));
      expect(true).toBe(false); // Should not reach here
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('alpha');
      expect(msg).toContain('beta');
    }
  });

  test('registerAgentAdapter throws on duplicate registration', () => {
    registerAgentAdapter('mock', (config) => new MockAgentAdapter(config));
    expect(() =>
      registerAgentAdapter('mock', (config) => new MockAgentAdapter(config))
    ).toThrow('Agent adapter already registered for type: mock');
  });

  test('createAgentAdapter validates config via Zod', () => {
    registerAgentAdapter('mock', (config) => new MockAgentAdapter(config));

    // Invalid config — empty agentType
    expect(() =>
      createAgentAdapter({ agentType: '', config: {}, toolPreferences: { primary: 'ralph', fallbacks: [] } })
    ).toThrow();
  });

  test('getRegisteredAgentTypes returns all registered types', () => {
    expect(getRegisteredAgentTypes()).toEqual([]);

    registerAgentAdapter('openclaw', (config) => new MockAgentAdapter(config));
    registerAgentAdapter('manual', (config) => new MockAgentAdapter(config));

    const types = getRegisteredAgentTypes();
    expect(types).toContain('openclaw');
    expect(types).toContain('manual');
    expect(types).toHaveLength(2);
  });

  test('hasAgentType checks registration', () => {
    expect(hasAgentType('openclaw')).toBe(false);
    registerAgentAdapter('openclaw', (config) => new MockAgentAdapter(config));
    expect(hasAgentType('openclaw')).toBe(true);
  });

  test('clearAgentAdapterRegistry removes all registrations', () => {
    registerAgentAdapter('a', (config) => new MockAgentAdapter(config));
    registerAgentAdapter('b', (config) => new MockAgentAdapter(config));
    expect(getRegisteredAgentTypes()).toHaveLength(2);

    clearAgentAdapterRegistry();
    expect(getRegisteredAgentTypes()).toHaveLength(0);
  });

  test('factory receives validated config', () => {
    let receivedConfig: AgentAdapterConfig | null = null;

    registerAgentAdapter('test-agent', (config) => {
      receivedConfig = config;
      return new MockAgentAdapter(config);
    });

    createAgentAdapter({
      agentType: 'test-agent',
      config: { model: 'opus' },
      toolPreferences: { primary: 'claude-code', fallbacks: ['ralph'] },
    });

    expect(receivedConfig).not.toBeNull();
    expect(receivedConfig!.agentType).toBe('test-agent');
    expect(receivedConfig!.config).toEqual({ model: 'opus' });
    expect(receivedConfig!.toolPreferences.primary).toBe('claude-code');
    expect(receivedConfig!.toolPreferences.fallbacks).toEqual(['ralph']);
  });

  test('multiple adapters can coexist', async () => {
    registerAgentAdapter('fast', (config) => new MockAgentAdapter(config));
    registerAgentAdapter('slow', (config) => new MockAgentAdapter(config));

    const fast = createAgentAdapter(makeConfig({ agentType: 'fast' })) as MockAgentAdapter;
    const slow = createAgentAdapter(makeConfig({ agentType: 'slow' })) as MockAgentAdapter;

    await fast.initialize(makeCell(), makeBlueprint());
    expect(fast.initialized).toBe(true);
    expect(slow.initialized).toBe(false);
  });
});

describe('Type contracts', () => {
  test('CellRef accepts all stack types', () => {
    const nodeCell = makeCell({ stackType: 'node' });
    const pythonCell = makeCell({ stackType: 'python' });
    const rustCell = makeCell({ stackType: 'rust' });

    expect(nodeCell.stackType).toBe('node');
    expect(pythonCell.stackType).toBe('python');
    expect(rustCell.stackType).toBe('rust');
  });

  test('Blueprint can have empty criteria', () => {
    const bp = makeBlueprint({ criteria: [] });
    expect(bp.criteria).toHaveLength(0);
  });

  test('EvolutionResult captures all fields', () => {
    const result: EvolutionResult = {
      success: false,
      criterionId: 'crit-x',
      summary: 'Failed to compile',
      filesChanged: [],
      criterionMet: false,
    };
    expect(result.success).toBe(false);
    expect(result.filesChanged).toHaveLength(0);
  });

  test('AgentAdapterStatus discriminated union works', () => {
    const idle: AgentAdapterStatus = { state: 'idle' };
    const evolving: AgentAdapterStatus = { state: 'evolving', currentTask: 'Build hero', criterionId: 'c1' };
    const stopped: AgentAdapterStatus = { state: 'stopped', reason: 'Done' };
    const error: AgentAdapterStatus = { state: 'error', error: 'Docker crashed' };

    expect(idle.state).toBe('idle');
    expect(evolving.state).toBe('evolving');
    if (evolving.state === 'evolving') {
      expect(evolving.currentTask).toBe('Build hero');
    }
    expect(stopped.state).toBe('stopped');
    expect(error.state).toBe('error');
  });
});
