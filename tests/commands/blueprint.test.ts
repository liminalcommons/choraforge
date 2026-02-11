/**
 * ABOUTME: Tests for the blueprint command.
 * Tests argument parsing, blueprint parsing/serialization, and loadBlueprint.
 */

import { describe, test, expect } from 'bun:test';
import { existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseBlueprintArgs,
  parseBlueprint,
  serializeBlueprint,
  loadBlueprint,
} from '../../src/commands/blueprint.js';

describe('parseBlueprintArgs', () => {
  test('returns defaults when no args', () => {
    const result = parseBlueprintArgs([]);
    expect(result.agent).toBe('claude');
    expect(result.model).toBe('opus');
    expect(result.help).toBe(false);
    expect(result.outputPath).toContain('evolution');
    expect(result.outputPath).toContain('blueprint.md');
  });

  test('parses --help flag', () => {
    expect(parseBlueprintArgs(['--help']).help).toBe(true);
    expect(parseBlueprintArgs(['-h']).help).toBe(true);
  });

  test('parses --agent flag', () => {
    const result = parseBlueprintArgs(['--agent', 'opencode']);
    expect(result.agent).toBe('opencode');
  });

  test('parses --model flag', () => {
    const result = parseBlueprintArgs(['--model', 'sonnet']);
    expect(result.model).toBe('sonnet');
  });

  test('parses --output flag', () => {
    const result = parseBlueprintArgs(['--output', '/tmp/bp.md']);
    expect(result.outputPath).toBe('/tmp/bp.md');
  });

  test('parses -o shorthand', () => {
    const result = parseBlueprintArgs(['-o', '/tmp/bp.md']);
    expect(result.outputPath).toBe('/tmp/bp.md');
  });

  test('parses --cwd flag', () => {
    const result = parseBlueprintArgs(['--cwd', '/tmp/project']);
    expect(result.cwd).toContain('project');
  });

  test('parses -C shorthand', () => {
    const result = parseBlueprintArgs(['-C', '/tmp/project']);
    expect(result.cwd).toContain('project');
  });

  test('parses multiple flags together', () => {
    const result = parseBlueprintArgs([
      '--agent', 'kimi-k2',
      '--model', 'kimi-k2.5',
      '-o', '/tmp/out.md',
    ]);
    expect(result.agent).toBe('kimi-k2');
    expect(result.model).toBe('kimi-k2.5');
    expect(result.outputPath).toBe('/tmp/out.md');
  });
});

describe('parseBlueprint', () => {
  test('parses a simple blueprint', () => {
    const content = `# Vision
Build a todo app.

# Acceptance Criteria
- AC-1 [P0]: Users can create tasks
- AC-2 [P1]: Tasks can be marked complete
- AC-3 [P2]: Tasks can have due dates

# Constraints
- Must use TypeScript
- No external dependencies

# Out of Scope
- Mobile app
- Offline mode
`;

    const blueprint = parseBlueprint(content);

    expect(blueprint.vision).toBe('Build a todo app.');
    expect(blueprint.criteria).toHaveLength(3);

    expect(blueprint.criteria[0]!.id).toBe('AC-1');
    expect(blueprint.criteria[0]!.priority).toBe('P0');
    expect(blueprint.criteria[0]!.description).toBe('Users can create tasks');
    expect(blueprint.criteria[0]!.met).toBe(false);

    expect(blueprint.criteria[1]!.id).toBe('AC-2');
    expect(blueprint.criteria[1]!.priority).toBe('P1');

    expect(blueprint.criteria[2]!.id).toBe('AC-3');
    expect(blueprint.criteria[2]!.priority).toBe('P2');

    expect(blueprint.constraints).toEqual(['Must use TypeScript', 'No external dependencies']);
    expect(blueprint.outOfScope).toEqual(['Mobile app', 'Offline mode']);
  });

  test('parses blueprint with [BLUEPRINT] markers', () => {
    const content = `Some preamble text.

[BLUEPRINT]
# Vision
Build an API.

# Acceptance Criteria
- AC-1 [P0]: REST endpoints work

# Constraints
- Use Express

# Out of Scope
- GraphQL
[/BLUEPRINT]

Some postamble text.`;

    const blueprint = parseBlueprint(content);

    expect(blueprint.vision).toBe('Build an API.');
    expect(blueprint.criteria).toHaveLength(1);
    expect(blueprint.criteria[0]!.id).toBe('AC-1');
    expect(blueprint.constraints).toEqual(['Use Express']);
    expect(blueprint.outOfScope).toEqual(['GraphQL']);
  });

  test('handles empty content', () => {
    const blueprint = parseBlueprint('');
    expect(blueprint.vision).toBe('');
    expect(blueprint.criteria).toHaveLength(0);
    expect(blueprint.constraints).toHaveLength(0);
    expect(blueprint.outOfScope).toHaveLength(0);
  });

  test('handles multi-line vision', () => {
    const content = `# Vision
Build a collaborative
note-taking application.

# Acceptance Criteria
- AC-1 [P0]: Notes can be created
`;

    const blueprint = parseBlueprint(content);
    expect(blueprint.vision).toBe('Build a collaborative\nnote-taking application.');
  });

  test('initializes metadata with version 1', () => {
    const blueprint = parseBlueprint('# Vision\nTest');
    expect(blueprint.metadata.version).toBe(1);
    expect(blueprint.metadata.createdAt).toBeDefined();
    expect(blueprint.metadata.lastModified).toBeDefined();
  });
});

describe('serializeBlueprint', () => {
  test('round-trips through parse and serialize', () => {
    const original = `# Vision
Build a todo app.

# Acceptance Criteria
- AC-1 [P0]: Users can create tasks
- AC-2 [P1]: Tasks can be marked complete

# Constraints
- Must use TypeScript

# Out of Scope
- Mobile app
`;

    const parsed = parseBlueprint(original);
    const serialized = serializeBlueprint(parsed);
    const reparsed = parseBlueprint(serialized);

    expect(reparsed.vision).toBe(parsed.vision);
    expect(reparsed.criteria).toHaveLength(parsed.criteria.length);
    expect(reparsed.criteria[0]!.id).toBe(parsed.criteria[0]!.id);
    expect(reparsed.criteria[0]!.description).toBe(parsed.criteria[0]!.description);
    expect(reparsed.criteria[0]!.priority).toBe(parsed.criteria[0]!.priority);
    expect(reparsed.constraints).toEqual(parsed.constraints);
    expect(reparsed.outOfScope).toEqual(parsed.outOfScope);
  });

  test('marks met criteria with checkmark', () => {
    const blueprint = parseBlueprint(`# Vision
Test

# Acceptance Criteria
- AC-1 [P0]: Something
`);
    blueprint.criteria[0]!.met = true;

    const serialized = serializeBlueprint(blueprint);
    expect(serialized).toContain('AC-1 [P0]: Something ✓');
  });

  test('includes metadata comment', () => {
    const blueprint = parseBlueprint('# Vision\nTest');
    const serialized = serializeBlueprint(blueprint);
    expect(serialized).toContain('<!-- metadata:');
  });
});

describe('loadBlueprint', () => {
  const testDir = join(process.cwd(), '.test-blueprint-tmp');
  const testFile = join(testDir, 'test-blueprint.md');

  test('returns null for non-existent file', () => {
    expect(loadBlueprint('/nonexistent/path/blueprint.md')).toBeNull();
  });

  test('loads and parses an existing blueprint file', () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(testFile, `# Vision
Test project.

# Acceptance Criteria
- AC-1 [P0]: Feature works

# Constraints
- None

# Out of Scope
- Nothing
`);

    try {
      const blueprint = loadBlueprint(testFile);
      expect(blueprint).not.toBeNull();
      expect(blueprint!.vision).toBe('Test project.');
      expect(blueprint!.criteria).toHaveLength(1);
      expect(blueprint!.criteria[0]!.id).toBe('AC-1');
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});
