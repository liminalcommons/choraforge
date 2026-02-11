/**
 * ABOUTME: App Registry for the Meta-Vibecoding platform.
 * Manages registration, persistence, and CRUD operations for apps
 * that the platform orchestrates. Persists to ~/.config/meta-vibecoding/apps.json.
 */

import { z } from 'zod';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { readFile, writeFile, mkdir, access, constants } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

/**
 * Stack types supported by the platform.
 */
export const StackTypeSchema = z.enum(['node', 'python', 'rust']);
export type StackType = z.infer<typeof StackTypeSchema>;

/**
 * App lifecycle status.
 */
export const AppStatusSchema = z.enum(['idle', 'running', 'paused', 'error']);
export type AppStatus = z.infer<typeof AppStatusSchema>;

/**
 * Schema for a single app registry entry.
 */
export const AppRegistryEntrySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(128),
  repoUrl: z.string().url(),
  agentType: z.string().min(1),
  stackType: StackTypeSchema,
  status: AppStatusSchema,
  currentVersion: z.string().default('0.0.0'),
  blueprintPath: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type AppRegistryEntry = z.infer<typeof AppRegistryEntrySchema>;

/**
 * Input for creating a new app (id and timestamps are auto-generated).
 */
export type CreateAppInput = Omit<AppRegistryEntry, 'id' | 'createdAt' | 'updatedAt' | 'status'> & {
  status?: AppStatus;
};

/**
 * Fields that can be updated on an existing app.
 */
export type UpdateAppInput = Partial<Omit<AppRegistryEntry, 'id' | 'createdAt'>>;

/**
 * Default persistence path for the app registry.
 */
const DEFAULT_REGISTRY_PATH = join(homedir(), '.config', 'meta-vibecoding', 'apps.json');

/**
 * App Registry — manages the collection of registered apps.
 *
 * Provides CRUD operations with JSON file persistence and duplicate prevention.
 * Follows the singleton pattern established by AgentRegistry.
 */
export class AppRegistry {
  private apps: Map<string, AppRegistryEntry> = new Map();
  private loaded = false;
  private registryPath: string;

  constructor(registryPath?: string) {
    this.registryPath = registryPath ?? DEFAULT_REGISTRY_PATH;
  }

  /**
   * Load registry from disk. No-op if already loaded.
   * Call this before any CRUD operation if you want persistence.
   */
  async load(): Promise<void> {
    if (this.loaded) return;

    try {
      await access(this.registryPath, constants.R_OK);
      const raw = await readFile(this.registryPath, 'utf-8');
      const parsed = JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        throw new Error('Registry file must contain a JSON array');
      }

      for (const entry of parsed) {
        const validated = AppRegistryEntrySchema.parse(entry);
        this.apps.set(validated.id, validated);
      }
    } catch (err: unknown) {
      // File doesn't exist yet — start empty
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        // Expected on first run
      } else if (err instanceof z.ZodError) {
        throw new Error(`Invalid registry data: ${err.message}`);
      }
      // For access() failures when file doesn't exist, also start empty
    }

    this.loaded = true;
  }

  /**
   * Persist registry to disk.
   */
  async save(): Promise<void> {
    const dir = dirname(this.registryPath);
    await mkdir(dir, { recursive: true });
    const entries = Array.from(this.apps.values());
    await writeFile(this.registryPath, JSON.stringify(entries, null, 2), 'utf-8');
  }

  /**
   * Create a new app entry.
   * @throws If an app with the same name or id already exists.
   */
  async create(input: CreateAppInput): Promise<AppRegistryEntry> {
    await this.load();

    // Check for duplicate name
    for (const existing of this.apps.values()) {
      if (existing.name === input.name) {
        throw new Error(`App with name '${input.name}' already exists (id: ${existing.id})`);
      }
    }

    const now = new Date().toISOString();
    const entry: AppRegistryEntry = {
      id: randomUUID(),
      name: input.name,
      repoUrl: input.repoUrl,
      agentType: input.agentType,
      stackType: input.stackType,
      status: input.status ?? 'idle',
      currentVersion: input.currentVersion,
      blueprintPath: input.blueprintPath,
      createdAt: now,
      updatedAt: now,
    };

    // Validate the complete entry
    AppRegistryEntrySchema.parse(entry);

    this.apps.set(entry.id, entry);
    await this.save();
    return entry;
  }

  /**
   * Get an app by ID.
   * @returns The app entry or undefined if not found.
   */
  async get(id: string): Promise<AppRegistryEntry | undefined> {
    await this.load();
    return this.apps.get(id);
  }

  /**
   * Get an app by name.
   * @returns The app entry or undefined if not found.
   */
  async getByName(name: string): Promise<AppRegistryEntry | undefined> {
    await this.load();
    for (const entry of this.apps.values()) {
      if (entry.name === name) return entry;
    }
    return undefined;
  }

  /**
   * List all registered apps.
   */
  async list(): Promise<AppRegistryEntry[]> {
    await this.load();
    return Array.from(this.apps.values());
  }

  /**
   * Update an existing app entry.
   * @throws If the app is not found.
   */
  async update(id: string, input: UpdateAppInput): Promise<AppRegistryEntry> {
    await this.load();

    const existing = this.apps.get(id);
    if (!existing) {
      throw new Error(`App not found: ${id}`);
    }

    // Check for name conflict if name is being changed
    if (input.name && input.name !== existing.name) {
      for (const other of this.apps.values()) {
        if (other.name === input.name && other.id !== id) {
          throw new Error(`App with name '${input.name}' already exists (id: ${other.id})`);
        }
      }
    }

    const updated: AppRegistryEntry = {
      ...existing,
      ...input,
      id: existing.id, // Never allow id change
      createdAt: existing.createdAt, // Never allow createdAt change
      updatedAt: new Date().toISOString(),
    };

    // Validate the updated entry
    AppRegistryEntrySchema.parse(updated);

    this.apps.set(id, updated);
    await this.save();
    return updated;
  }

  /**
   * Delete an app by ID.
   * @returns true if the app was deleted, false if not found.
   */
  async delete(id: string): Promise<boolean> {
    await this.load();

    if (!this.apps.has(id)) {
      return false;
    }

    this.apps.delete(id);
    await this.save();
    return true;
  }

  /**
   * Get the number of registered apps.
   */
  async count(): Promise<number> {
    await this.load();
    return this.apps.size;
  }

  /**
   * Get the registry file path.
   */
  getRegistryPath(): string {
    return this.registryPath;
  }
}
