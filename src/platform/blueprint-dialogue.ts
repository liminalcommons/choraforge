/**
 * ABOUTME: Blueprint Dialogue Engine for the Meta-Vibecoding platform.
 * Provides conversational blueprint creation via WebSocket.
 * Uses Anthropic API directly (Opus 4.6) to guide a human through
 * defining vision, acceptance criteria, constraints, and out-of-scope items.
 * Conversation history is maintained server-side per dialogue session.
 */

import type { Blueprint, BlueprintCriterion } from '../commands/blueprint.js';
import { serializeBlueprint } from '../commands/blueprint.js';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ─── Types ───────────────────────────────────────────────────────────────────

/** A single message in the dialogue history. */
export interface DialogueHistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

/** Active dialogue session state. */
export interface DialogueSession {
  /** Unique session ID */
  id: string;
  /** App ID this dialogue is for */
  appId: string;
  /** Conversation history for context */
  history: DialogueHistoryEntry[];
  /** Whether the blueprint is ready for human review */
  blueprintReady: boolean;
  /** Draft blueprint (set when AI determines it's ready) */
  draftBlueprint: Blueprint | null;
  /** When the session started (ISO 8601) */
  createdAt: string;
  /** When the session was last active (ISO 8601) */
  lastActiveAt: string;
}

/** Options for creating a dialogue engine. */
export interface BlueprintDialogueOptions {
  /** Anthropic API key. Defaults to ANTHROPIC_API_KEY env var. */
  apiKey?: string;
  /** Model to use. Defaults to claude-opus-4-6. */
  model?: string;
  /** Anthropic API base URL. Defaults to https://api.anthropic.com. */
  apiBaseUrl?: string;
  /** Maximum tokens per response. Defaults to 2048. */
  maxTokens?: number;
}

/** Result from sending a message to the dialogue. */
export interface DialogueTurnResult {
  /** The assistant's response */
  assistantMessage: string;
  /** Whether the AI thinks the blueprint is ready for review */
  blueprintReady: boolean;
  /** Extracted draft blueprint (if ready) */
  draftBlueprint: Blueprint | null;
}

/** Result from saving a finalized blueprint. */
export interface BlueprintSaveResult {
  success: boolean;
  error?: string;
  mdPath?: string;
  jsonPath?: string;
}

// ─── System Prompt ───────────────────────────────────────────────────────────

const DIALOGUE_SYSTEM_PROMPT = `You are a senior software architect helping a human define a project blueprint through conversation.

Your job: Ask focused questions, listen carefully, and build a structured blueprint.

## Conversation Flow

1. **Understand the vision** (1-2 questions)
   - What are we building? What problem does it solve? Who are the users?

2. **Define acceptance criteria** (2-3 questions)
   - What does "done" look like? Break it into specific, testable criteria.
   - Assign priorities: P0 (must-have), P1 (should-have), P2 (nice-to-have)

3. **Identify constraints** (1 question)
   - Technical constraints, time limits, existing systems to integrate with?

4. **Define out-of-scope** (1 question)
   - What are we explicitly NOT building?

5. **Present the blueprint** for approval

## Rules

- Ask 1-2 questions at a time, not all at once
- Adapt based on answers — if someone mentions constraints early, don't re-ask
- Be conversational, not interrogative
- After gathering enough info (typically 4-6 exchanges), present the draft blueprint

## When Ready

When you have enough information, present the draft blueprint in this EXACT format:

[BLUEPRINT_DRAFT]
{
  "vision": "2-3 sentence description of what we're building and why",
  "criteria": [
    { "id": "AC-1", "description": "...", "priority": "P0", "met": false },
    { "id": "AC-2", "description": "...", "priority": "P0", "met": false },
    { "id": "AC-3", "description": "...", "priority": "P1", "met": false }
  ],
  "constraints": ["constraint 1", "constraint 2"],
  "outOfScope": ["item 1", "item 2"]
}
[/BLUEPRINT_DRAFT]

After showing the draft, ask: "Does this capture your vision? Feel free to suggest changes, or approve it to finalize."

If they suggest changes, incorporate them and present the updated draft.
If they approve, output the final version in the same format.`;

// ─── Engine ──────────────────────────────────────────────────────────────────

/**
 * Blueprint Dialogue Engine.
 * Manages multiple concurrent dialogue sessions, each with their own
 * conversation history and state. Uses the Anthropic Messages API
 * to generate adaptive, context-aware questions.
 */
export class BlueprintDialogueEngine {
  private sessions: Map<string, DialogueSession> = new Map();
  private apiKey: string;
  private model: string;
  private apiBaseUrl: string;
  private maxTokens: number;

  constructor(options?: BlueprintDialogueOptions) {
    this.apiKey = options?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
    this.model = options?.model ?? 'claude-opus-4-6';
    this.apiBaseUrl = options?.apiBaseUrl ?? 'https://api.anthropic.com';
    this.maxTokens = options?.maxTokens ?? 2048;
  }

  /**
   * Start a new dialogue session.
   * Returns the session ID and the AI's opening message.
   */
  async startDialogue(appId: string, initialContext?: string): Promise<{ dialogueId: string; assistantMessage: string }> {
    if (!this.apiKey) {
      throw new Error('ANTHROPIC_API_KEY not set. Required for blueprint dialogue.');
    }

    const dialogueId = `dialogue-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    const session: DialogueSession = {
      id: dialogueId,
      appId,
      history: [],
      blueprintReady: false,
      draftBlueprint: null,
      createdAt: now,
      lastActiveAt: now,
    };

    this.sessions.set(dialogueId, session);

    // Build the opening prompt
    const openingPrompt = initialContext
      ? `The human wants to create a blueprint. They started with this context: "${initialContext}"\n\nGreet them briefly and ask your first clarifying question based on what they've shared.`
      : 'The human wants to create a new app blueprint. Greet them briefly and ask your first question to understand what they want to build.';

    // Get the AI's opening message
    const response = await this.callAnthropic(session, openingPrompt);
    return { dialogueId, assistantMessage: response };
  }

  /**
   * Send a human message and get the AI's response.
   */
  async sendMessage(dialogueId: string, content: string): Promise<DialogueTurnResult> {
    const session = this.sessions.get(dialogueId);
    if (!session) {
      throw new Error(`Dialogue session not found: ${dialogueId}`);
    }

    session.lastActiveAt = new Date().toISOString();

    // Get AI response
    const assistantMessage = await this.callAnthropic(session, content);

    // Check if the response contains a blueprint draft
    const draftBlueprint = this.extractBlueprintDraft(assistantMessage);
    if (draftBlueprint) {
      session.blueprintReady = true;
      session.draftBlueprint = draftBlueprint;
    }

    return {
      assistantMessage,
      blueprintReady: session.blueprintReady,
      draftBlueprint: session.draftBlueprint,
    };
  }

  /**
   * Save a finalized blueprint to disk.
   */
  saveBlueprint(dialogueId: string, blueprint: Blueprint, cellDir: string): BlueprintSaveResult {
    const session = this.sessions.get(dialogueId);
    if (!session) {
      return { success: false, error: `Dialogue session not found: ${dialogueId}` };
    }

    const evolutionDir = join(cellDir, 'evolution');
    const mdPath = join(evolutionDir, 'blueprint.md');
    const jsonPath = join(evolutionDir, 'blueprint.json');

    try {
      // Ensure directory exists
      if (!existsSync(evolutionDir)) {
        mkdirSync(evolutionDir, { recursive: true });
      }

      // Add metadata to blueprint
      const blueprintWithMeta: Blueprint & { metadata?: Record<string, unknown> } = {
        ...blueprint,
        metadata: {
          createdAt: session.createdAt,
          lastModified: new Date().toISOString(),
          version: 1,
          dialogueId: session.id,
          appId: session.appId,
        },
      };

      // Write markdown version
      const mdContent = serializeBlueprint(blueprintWithMeta as Blueprint);
      writeFileSync(mdPath, mdContent, 'utf-8');

      // Write JSON version
      writeFileSync(jsonPath, JSON.stringify(blueprintWithMeta, null, 2), 'utf-8');

      // Clean up session
      this.sessions.delete(dialogueId);

      return { success: true, mdPath, jsonPath };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to save blueprint',
      };
    }
  }

  /**
   * Get a dialogue session by ID.
   */
  getSession(dialogueId: string): DialogueSession | undefined {
    return this.sessions.get(dialogueId);
  }

  /**
   * Clean up a dialogue session without saving.
   */
  cancelDialogue(dialogueId: string): boolean {
    return this.sessions.delete(dialogueId);
  }

  /**
   * Get the number of active sessions.
   */
  get activeSessionCount(): number {
    return this.sessions.size;
  }

  // ─── Internal: Anthropic API ──────────────────────────────────────────

  /**
   * Call the Anthropic Messages API with the conversation history.
   * Adds the user message to history, calls API, adds assistant response to history.
   */
  private async callAnthropic(session: DialogueSession, userMessage: string): Promise<string> {
    // Add user message to history
    session.history.push({ role: 'user', content: userMessage });

    const messages = session.history.map((entry) => ({
      role: entry.role,
      content: entry.content,
    }));

    const response = await fetch(`${this.apiBaseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        system: DIALOGUE_SYSTEM_PROMPT,
        messages,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      // Remove the user message we just added since the call failed
      session.history.pop();
      throw new Error(`Anthropic API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text?: string }>;
    };

    const assistantText = data.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');

    // Add assistant response to history
    session.history.push({ role: 'assistant', content: assistantText });

    return assistantText;
  }

  /**
   * Extract a Blueprint draft from the AI's response.
   * Looks for [BLUEPRINT_DRAFT]...[/BLUEPRINT_DRAFT] markers containing JSON.
   */
  private extractBlueprintDraft(response: string): Blueprint | null {
    const match = response.match(/\[BLUEPRINT_DRAFT\]\s*([\s\S]*?)\s*\[\/BLUEPRINT_DRAFT\]/);
    if (!match) return null;

    try {
      const raw = JSON.parse(match[1]!) as {
        vision?: string;
        criteria?: Array<{
          id?: string;
          description?: string;
          priority?: string;
          met?: boolean;
        }>;
        constraints?: string[];
        outOfScope?: string[];
      };

      // Validate minimal structure
      if (!raw.vision || !Array.isArray(raw.criteria)) return null;

      const criteria: BlueprintCriterion[] = raw.criteria.map((c, i) => ({
        id: c.id ?? `AC-${i + 1}`,
        description: c.description ?? '',
        priority: c.priority as 'P0' | 'P1' | 'P2' ?? 'P1',
        met: c.met ?? false,
      }));

      return {
        vision: raw.vision,
        criteria,
        constraints: raw.constraints ?? [],
        outOfScope: raw.outOfScope ?? [],
        metadata: {
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          version: 1,
        },
      };
    } catch {
      return null;
    }
  }
}
