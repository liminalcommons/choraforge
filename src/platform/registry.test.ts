/**
 * ABOUTME: Unit tests for the App Registry CRUD operations.
 * Tests creation, retrieval, listing, updates, deletion, persistence,
 * and duplicate prevention.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AppRegistry, type CreateAppInput } from './registry.js';

/** Helper to create a temp directory for each test */
async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'app-registry-test-'));
}

/** Helper to build a valid CreateAppInput */
function makeApp(overrides: Partial<CreateAppInput> = {}): CreateAppInput {
  return {
    name: 'test-app',
    repoUrl: 'https://github.com/example/test-app',
    agentType: 'openclaw',
    stackType: 'node',
    currentVersion: '1.0.0',
    ...overrides,
  };
}

describe('AppRegistry', () => {
  let tempDir: string;
  let registryPath: string;
  let registry: AppRegistry;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    registryPath = join(tempDir, 'apps.json');
    registry = new AppRegistry(registryPath);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('create', () => {
    test('creates an app with auto-generated id and timestamps', async () => {
      const app = await registry.create(makeApp());

      expect(app.id).toBeDefined();
      expect(app.id.length).toBe(36); // UUID format
      expect(app.name).toBe('test-app');
      expect(app.repoUrl).toBe('https://github.com/example/test-app');
      expect(app.agentType).toBe('openclaw');
      expect(app.stackType).toBe('node');
      expect(app.status).toBe('idle'); // default
      expect(app.currentVersion).toBe('1.0.0');
      expect(app.createdAt).toBeDefined();
      expect(app.updatedAt).toBeDefined();
    });

    test('allows setting initial status', async () => {
      const app = await registry.create(makeApp({ status: 'running' }));
      expect(app.status).toBe('running');
    });

    test('allows setting blueprintPath', async () => {
      const app = await registry.create(makeApp({ blueprintPath: '/path/to/blueprint.yaml' }));
      expect(app.blueprintPath).toBe('/path/to/blueprint.yaml');
    });

    test('persists to disk after create', async () => {
      await registry.create(makeApp());

      const raw = await readFile(registryPath, 'utf-8');
      const data = JSON.parse(raw);
      expect(data).toHaveLength(1);
      expect(data[0].name).toBe('test-app');
    });

    test('rejects duplicate app name', async () => {
      await registry.create(makeApp());
      await expect(registry.create(makeApp())).rejects.toThrow(
        "App with name 'test-app' already exists"
      );
    });

    test('allows different names', async () => {
      await registry.create(makeApp({ name: 'app-1' }));
      const app2 = await registry.create(makeApp({ name: 'app-2' }));
      expect(app2.name).toBe('app-2');
    });

    test('validates required fields', async () => {
      await expect(
        registry.create(makeApp({ name: '' }))
      ).rejects.toThrow();
    });

    test('validates repoUrl format', async () => {
      await expect(
        registry.create(makeApp({ repoUrl: 'not-a-url' }))
      ).rejects.toThrow();
    });

    test('validates stackType enum', async () => {
      await expect(
        registry.create(makeApp({ stackType: 'java' as any }))
      ).rejects.toThrow();
    });
  });

  describe('get', () => {
    test('returns app by id', async () => {
      const created = await registry.create(makeApp());
      const fetched = await registry.get(created.id);
      expect(fetched).toEqual(created);
    });

    test('returns undefined for unknown id', async () => {
      const fetched = await registry.get('non-existent-id');
      expect(fetched).toBeUndefined();
    });
  });

  describe('getByName', () => {
    test('returns app by name', async () => {
      const created = await registry.create(makeApp({ name: 'my-app' }));
      const fetched = await registry.getByName('my-app');
      expect(fetched).toEqual(created);
    });

    test('returns undefined for unknown name', async () => {
      const fetched = await registry.getByName('not-here');
      expect(fetched).toBeUndefined();
    });
  });

  describe('list', () => {
    test('returns empty array when no apps', async () => {
      const apps = await registry.list();
      expect(apps).toEqual([]);
    });

    test('returns all apps', async () => {
      await registry.create(makeApp({ name: 'app-a' }));
      await registry.create(makeApp({ name: 'app-b' }));
      await registry.create(makeApp({ name: 'app-c' }));

      const apps = await registry.list();
      expect(apps).toHaveLength(3);
      const names = apps.map((a) => a.name).sort();
      expect(names).toEqual(['app-a', 'app-b', 'app-c']);
    });
  });

  describe('update', () => {
    test('updates status', async () => {
      const created = await registry.create(makeApp());
      const updated = await registry.update(created.id, { status: 'running' });

      expect(updated.status).toBe('running');
      expect(updated.id).toBe(created.id);
      expect(updated.createdAt).toBe(created.createdAt);
      expect(updated.updatedAt).not.toBe(created.updatedAt);
    });

    test('updates multiple fields', async () => {
      const created = await registry.create(makeApp());
      const updated = await registry.update(created.id, {
        status: 'paused',
        currentVersion: '2.0.0',
        blueprintPath: '/new/path.yaml',
      });

      expect(updated.status).toBe('paused');
      expect(updated.currentVersion).toBe('2.0.0');
      expect(updated.blueprintPath).toBe('/new/path.yaml');
    });

    test('persists update to disk', async () => {
      const created = await registry.create(makeApp());
      await registry.update(created.id, { status: 'running' });

      const raw = await readFile(registryPath, 'utf-8');
      const data = JSON.parse(raw);
      expect(data[0].status).toBe('running');
    });

    test('throws for unknown id', async () => {
      await expect(
        registry.update('non-existent', { status: 'running' })
      ).rejects.toThrow('App not found');
    });

    test('prevents duplicate name on update', async () => {
      await registry.create(makeApp({ name: 'app-1' }));
      const app2 = await registry.create(makeApp({ name: 'app-2' }));

      await expect(
        registry.update(app2.id, { name: 'app-1' })
      ).rejects.toThrow("App with name 'app-1' already exists");
    });

    test('allows keeping the same name on update', async () => {
      const created = await registry.create(makeApp({ name: 'my-app' }));
      const updated = await registry.update(created.id, { name: 'my-app', status: 'running' });
      expect(updated.name).toBe('my-app');
      expect(updated.status).toBe('running');
    });

    test('cannot change id via update', async () => {
      const created = await registry.create(makeApp());
      const updated = await registry.update(created.id, { id: 'hacked-id' } as any);
      expect(updated.id).toBe(created.id);
    });

    test('cannot change createdAt via update', async () => {
      const created = await registry.create(makeApp());
      const updated = await registry.update(created.id, { createdAt: '1999-01-01T00:00:00.000Z' } as any);
      expect(updated.createdAt).toBe(created.createdAt);
    });
  });

  describe('delete', () => {
    test('deletes existing app', async () => {
      const created = await registry.create(makeApp());
      const result = await registry.delete(created.id);
      expect(result).toBe(true);

      const fetched = await registry.get(created.id);
      expect(fetched).toBeUndefined();
    });

    test('returns false for unknown id', async () => {
      const result = await registry.delete('non-existent');
      expect(result).toBe(false);
    });

    test('persists deletion to disk', async () => {
      const created = await registry.create(makeApp());
      await registry.delete(created.id);

      const raw = await readFile(registryPath, 'utf-8');
      const data = JSON.parse(raw);
      expect(data).toHaveLength(0);
    });
  });

  describe('count', () => {
    test('returns 0 when empty', async () => {
      expect(await registry.count()).toBe(0);
    });

    test('returns correct count', async () => {
      await registry.create(makeApp({ name: 'a' }));
      await registry.create(makeApp({ name: 'b' }));
      expect(await registry.count()).toBe(2);
    });
  });

  describe('persistence', () => {
    test('loads from existing file on new instance', async () => {
      // Create apps with first instance
      await registry.create(makeApp({ name: 'persisted-app' }));

      // Create new instance pointing to same file
      const registry2 = new AppRegistry(registryPath);
      const apps = await registry2.list();
      expect(apps).toHaveLength(1);
      expect(apps[0]!.name).toBe('persisted-app');
    });

    test('handles empty registry file gracefully', async () => {
      // Write empty array
      const { writeFile: wf } = await import('node:fs/promises');
      await wf(registryPath, '[]', 'utf-8');

      const fresh = new AppRegistry(registryPath);
      const apps = await fresh.list();
      expect(apps).toEqual([]);
    });

    test('handles non-existent file gracefully', async () => {
      const fresh = new AppRegistry(join(tempDir, 'does-not-exist.json'));
      const apps = await fresh.list();
      expect(apps).toEqual([]);
    });
  });

  describe('getRegistryPath', () => {
    test('returns configured path', () => {
      expect(registry.getRegistryPath()).toBe(registryPath);
    });
  });
});
