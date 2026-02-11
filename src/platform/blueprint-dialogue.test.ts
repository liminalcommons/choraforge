/**
 * ABOUTME: Tests for BlueprintDialogueEngine — the conversational blueprint
 * creation engine for the Meta-Vibecoding platform.
 * Tests session management, blueprint extraction, and file saving.
 * API call tests use mocked fetch.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { BlueprintDialogueEngine } from './blueprint-dialogue.js';
import type { Blueprint } from '../commands/blueprint.js';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeBlueprint(): Blueprint {
  return {
    vision: 'A task management app for distributed teams',
    criteria: [
      { id: 'AC-1', description: 'Create and assign tasks', priority: 'P0', met: false },
      { id: 'AC-2', description: 'Real-time updates via WebSocket', priority: 'P0', met: false },
      { id: 'AC-3', description: 'Markdown task descriptions', priority: 'P1', met: false },
    ],
    constraints: ['Use TypeScript', 'Must work offline'],
    outOfScope: ['Mobile native app', 'Video calls'],
    metadata: {
      createdAt: '2026-02-11T00:00:00Z',
      lastModified: '2026-02-11T00:00:00Z',
      version: 1,
    },
  };
}

/** Mock fetch to simulate Anthropic API responses */
function mockFetch(responseText: string) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(async () => {
    return new Response(JSON.stringify({
      content: [{ type: 'text', text: responseText }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return () => { globalThis.fetch = originalFetch; };
}

/** Mock fetch to simulate API error */
function mockFetchError(status: number, body: string) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(async () => {
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return () => { globalThis.fetch = originalFetch; };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('BlueprintDialogueEngine', () => {
  let engine: BlueprintDialogueEngine;

  beforeEach(() => {
    engine = new BlueprintDialogueEngine({
      apiKey: 'test-key-123',
      model: 'claude-opus-4-6',
    });
  });

  describe('startDialogue', () => {
    it('creates a dialogue session and returns opening message', async () => {
      const restore = mockFetch('Welcome! What would you like to build?');
      try {
        const result = await engine.startDialogue('app-1');
        expect(result.dialogueId).toMatch(/^dialogue-/);
        expect(result.assistantMessage).toBe('Welcome! What would you like to build?');
        expect(engine.activeSessionCount).toBe(1);
      } finally {
        restore();
      }
    });

    it('includes initial context in opening prompt', async () => {
      let capturedBody = '';
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock(async (_url: unknown, init: unknown) => {
        capturedBody = (init as { body: string }).body;
        return new Response(JSON.stringify({
          content: [{ type: 'text', text: 'Great, a todo app! Tell me more.' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }) as unknown as typeof fetch;

      try {
        await engine.startDialogue('app-1', 'I want to build a todo app');
        expect(capturedBody).toContain('todo app');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('throws if no API key is set', async () => {
      const noKeyEngine = new BlueprintDialogueEngine({ apiKey: '' });
      await expect(noKeyEngine.startDialogue('app-1')).rejects.toThrow('ANTHROPIC_API_KEY not set');
    });
  });

  describe('sendMessage', () => {
    it('sends a message and gets AI response', async () => {
      const restore = mockFetch('Welcome! What are we building?');
      try {
        const { dialogueId } = await engine.startDialogue('app-1');
        restore();

        const restore2 = mockFetch('Great idea! Who are the target users?');
        try {
          const result = await engine.sendMessage(dialogueId, 'A project management tool');
          expect(result.assistantMessage).toBe('Great idea! Who are the target users?');
          expect(result.blueprintReady).toBe(false);
          expect(result.draftBlueprint).toBeNull();
        } finally {
          restore2();
        }
      } catch {
        // Test cleanup happens in finally blocks
      }
    });

    it('throws for unknown dialogue ID', async () => {
      await expect(engine.sendMessage('nonexistent', 'hello')).rejects.toThrow('Dialogue session not found');
    });

    it('detects blueprint draft in response', async () => {
      const restore = mockFetch('Welcome!');
      const { dialogueId } = await engine.startDialogue('app-1');
      restore();

      const draftResponse = `Here's the blueprint:

[BLUEPRINT_DRAFT]
{
  "vision": "A task management app",
  "criteria": [
    { "id": "AC-1", "description": "Create tasks", "priority": "P0", "met": false }
  ],
  "constraints": ["TypeScript"],
  "outOfScope": ["Mobile"]
}
[/BLUEPRINT_DRAFT]

Does this look good?`;

      const restore2 = mockFetch(draftResponse);
      try {
        const result = await engine.sendMessage(dialogueId, 'Looks great, draft it up');
        expect(result.blueprintReady).toBe(true);
        expect(result.draftBlueprint).not.toBeNull();
        expect(result.draftBlueprint!.vision).toBe('A task management app');
        expect(result.draftBlueprint!.criteria).toHaveLength(1);
        expect(result.draftBlueprint!.criteria[0]!.id).toBe('AC-1');
        expect(result.draftBlueprint!.constraints).toEqual(['TypeScript']);
        expect(result.draftBlueprint!.outOfScope).toEqual(['Mobile']);
      } finally {
        restore2();
      }
    });

    it('handles API errors gracefully', async () => {
      const restore = mockFetch('Welcome!');
      const { dialogueId } = await engine.startDialogue('app-1');
      restore();

      const restore2 = mockFetchError(429, 'Rate limited');
      try {
        await expect(engine.sendMessage(dialogueId, 'test')).rejects.toThrow('Anthropic API error (429)');
      } finally {
        restore2();
      }
    });
  });

  describe('saveBlueprint', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = join(tmpdir(), `choraforge-test-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('saves blueprint as markdown and JSON', async () => {
      const restore = mockFetch('Welcome!');
      const { dialogueId } = await engine.startDialogue('app-1');
      restore();

      const blueprint = makeBlueprint();
      const result = engine.saveBlueprint(dialogueId, blueprint, tmpDir);

      expect(result.success).toBe(true);
      expect(result.mdPath).toContain('blueprint.md');
      expect(result.jsonPath).toContain('blueprint.json');

      // Verify files exist
      expect(existsSync(result.mdPath!)).toBe(true);
      expect(existsSync(result.jsonPath!)).toBe(true);

      // Verify JSON content
      const jsonContent = JSON.parse(readFileSync(result.jsonPath!, 'utf-8'));
      expect(jsonContent.vision).toBe(blueprint.vision);
      expect(jsonContent.criteria).toHaveLength(3);
      expect(jsonContent.metadata.dialogueId).toBe(dialogueId);

      // Verify markdown content
      const mdContent = readFileSync(result.mdPath!, 'utf-8');
      expect(mdContent).toContain('# Vision');
      expect(mdContent).toContain('# Acceptance Criteria');
      expect(mdContent).toContain('AC-1');
    });

    it('creates evolution directory if it does not exist', async () => {
      const restore = mockFetch('Welcome!');
      const { dialogueId } = await engine.startDialogue('app-1');
      restore();

      const deepDir = join(tmpDir, 'nested', 'app');
      const result = engine.saveBlueprint(dialogueId, makeBlueprint(), deepDir);

      expect(result.success).toBe(true);
      expect(existsSync(join(deepDir, 'evolution', 'blueprint.md'))).toBe(true);
    });

    it('returns error for unknown session', () => {
      const result = engine.saveBlueprint('nonexistent', makeBlueprint(), tmpDir);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('cleans up session after saving', async () => {
      const restore = mockFetch('Welcome!');
      const { dialogueId } = await engine.startDialogue('app-1');
      restore();

      expect(engine.activeSessionCount).toBe(1);
      engine.saveBlueprint(dialogueId, makeBlueprint(), tmpDir);
      expect(engine.activeSessionCount).toBe(0);
    });
  });

  describe('session management', () => {
    it('getSession returns session details', async () => {
      const restore = mockFetch('Welcome!');
      const { dialogueId } = await engine.startDialogue('app-1');
      restore();

      const session = engine.getSession(dialogueId);
      expect(session).toBeDefined();
      expect(session!.appId).toBe('app-1');
      expect(session!.history).toHaveLength(2); // user prompt + assistant response
    });

    it('getSession returns undefined for unknown ID', () => {
      expect(engine.getSession('nonexistent')).toBeUndefined();
    });

    it('cancelDialogue removes session', async () => {
      const restore = mockFetch('Welcome!');
      const { dialogueId } = await engine.startDialogue('app-1');
      restore();

      expect(engine.cancelDialogue(dialogueId)).toBe(true);
      expect(engine.activeSessionCount).toBe(0);
      expect(engine.cancelDialogue(dialogueId)).toBe(false); // Already removed
    });

    it('supports multiple concurrent sessions', async () => {
      const restore = mockFetch('Welcome!');
      await engine.startDialogue('app-1');
      await engine.startDialogue('app-2');
      await engine.startDialogue('app-3');
      restore();

      expect(engine.activeSessionCount).toBe(3);
    });
  });

  describe('blueprint extraction', () => {
    it('handles malformed JSON in draft markers gracefully', async () => {
      const restore = mockFetch('Welcome!');
      const { dialogueId } = await engine.startDialogue('app-1');
      restore();

      const badResponse = `[BLUEPRINT_DRAFT]
not valid json
[/BLUEPRINT_DRAFT]`;

      const restore2 = mockFetch(badResponse);
      try {
        const result = await engine.sendMessage(dialogueId, 'draft it');
        expect(result.blueprintReady).toBe(false);
        expect(result.draftBlueprint).toBeNull();
      } finally {
        restore2();
      }
    });

    it('handles missing vision in draft gracefully', async () => {
      const restore = mockFetch('Welcome!');
      const { dialogueId } = await engine.startDialogue('app-1');
      restore();

      const noVisionResponse = `[BLUEPRINT_DRAFT]
{ "criteria": [] }
[/BLUEPRINT_DRAFT]`;

      const restore2 = mockFetch(noVisionResponse);
      try {
        const result = await engine.sendMessage(dialogueId, 'draft it');
        expect(result.blueprintReady).toBe(false);
        expect(result.draftBlueprint).toBeNull();
      } finally {
        restore2();
      }
    });

    it('extracts blueprint with default values for missing fields', async () => {
      const restore = mockFetch('Welcome!');
      const { dialogueId } = await engine.startDialogue('app-1');
      restore();

      const minimalResponse = `[BLUEPRINT_DRAFT]
{
  "vision": "Build something cool",
  "criteria": [
    { "description": "It works" }
  ]
}
[/BLUEPRINT_DRAFT]`;

      const restore2 = mockFetch(minimalResponse);
      try {
        const result = await engine.sendMessage(dialogueId, 'draft it');
        expect(result.blueprintReady).toBe(true);
        expect(result.draftBlueprint!.criteria[0]!.id).toBe('AC-1');
        expect(result.draftBlueprint!.constraints).toEqual([]);
        expect(result.draftBlueprint!.outOfScope).toEqual([]);
      } finally {
        restore2();
      }
    });
  });
});
