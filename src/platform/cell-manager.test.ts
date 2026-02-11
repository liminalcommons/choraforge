/**
 * ABOUTME: Tests for the Docker Cell Manager.
 * Uses a mock Docker client to test container lifecycle without requiring Docker.
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import {
  CellManager,
  DockerNotAvailableError,
  ImageNotFoundError,
  CellNotFoundError,
  CellAlreadyExistsError,
  type CreateCellOptions,
} from './cell-manager.js';

// ─── Mock Docker Client ──────────────────────────────────────────────────────

interface MockContainerState {
  name: string;
  image: string;
  running: boolean;
  labels: Record<string, string>;
  env: string[];
  exitCode: number;
  startedAt: string;
  finishedAt: string;
  error: string;
  workingDir: string;
}

interface MockVolumeState {
  name: string;
}

function createMockDocker() {
  const containers = new Map<string, MockContainerState>();
  const volumes = new Map<string, MockVolumeState>();
  const images = new Set<string>([
    'meta-vibecoding/cell-node:latest',
    'meta-vibecoding/cell-python:latest',
    'meta-vibecoding/cell-rust:latest',
  ]);

  let pingWorks = true;

  const makeExecStream = (_exitCode: number) => ({
    on: (event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'end') setTimeout(() => handler(), 0);
      if (event === 'data') handler(Buffer.from('mock output'));
    },
  });

  const makeExec = (exitCode: number) => ({
    start: mock(async (_opts: unknown) => makeExecStream(exitCode)),
    inspect: mock(async () => ({ ExitCode: exitCode })),
  });

  const makeContainer = (name: string) => ({
    inspect: mock(async () => {
      const state = containers.get(name);
      if (!state) {
        const err = new Error('not found') as Error & { statusCode: number };
        err.statusCode = 404;
        throw err;
      }
      return {
        State: {
          Running: state.running,
          ExitCode: state.exitCode,
          StartedAt: state.startedAt,
          FinishedAt: state.finishedAt,
          Error: state.error,
        },
        Config: {
          Labels: state.labels,
        },
      };
    }),
    start: mock(async () => {
      const state = containers.get(name);
      if (!state) throw new Error('not found');
      state.running = true;
      state.startedAt = new Date().toISOString();
    }),
    stop: mock(async () => {
      const state = containers.get(name);
      if (!state) throw new Error('not found');
      state.running = false;
      state.finishedAt = new Date().toISOString();
    }),
    remove: mock(async () => {
      containers.delete(name);
    }),
    exec: mock(async (_opts: unknown) => makeExec(0)),
  });

  const dockerMock = {
    ping: mock(async () => {
      if (!pingWorks) throw new Error('Docker not available');
      return 'OK';
    }),
    createContainer: mock(async (opts: {
      name: string;
      Image: string;
      Env?: string[];
      WorkingDir?: string;
      Labels?: Record<string, string>;
      Cmd?: string[];
    }) => {
      const state: MockContainerState = {
        name: opts.name,
        image: opts.Image,
        running: false,
        labels: opts.Labels ?? {},
        env: opts.Env ?? [],
        exitCode: 0,
        startedAt: '',
        finishedAt: '',
        error: '',
        workingDir: opts.WorkingDir ?? '/workspace',
      };
      containers.set(opts.name, state);
      return makeContainer(opts.name);
    }),
    createVolume: mock(async (opts: { Name: string }) => {
      volumes.set(opts.Name, { name: opts.Name });
      return { Name: opts.Name };
    }),
    getContainer: mock((name: string) => makeContainer(name)),
    getVolume: mock((name: string) => ({
      remove: mock(async () => {
        if (!volumes.has(name)) {
          const err = new Error('not found') as Error & { statusCode: number };
          err.statusCode = 404;
          throw err;
        }
        volumes.delete(name);
      }),
    })),
    getImage: mock((name: string) => ({
      inspect: mock(async () => {
        if (!images.has(name)) {
          const err = new Error('not found') as Error & { statusCode: number };
          err.statusCode = 404;
          throw err;
        }
        return { Id: name };
      }),
    })),
    listContainers: mock(async (_opts: unknown) => {
      const result: Array<{ Names: string[]; State: string; Labels: Record<string, string> }> = [];
      for (const [name, state] of containers) {
        if (state.labels['meta-vibecoding.managed'] === 'true') {
          result.push({
            Names: [`/${name}`],
            State: state.running ? 'running' : 'exited',
            Labels: state.labels,
          });
        }
      }
      return result;
    }),
    _setPingWorks: (v: boolean) => { pingWorks = v; },
    _containers: containers,
    _volumes: volumes,
    _images: images,
  };

  return dockerMock;
}

type MockDocker = ReturnType<typeof createMockDocker>;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CellManager', () => {
  let mockDocker: MockDocker;
  let manager: CellManager;

  const defaultOptions: CreateCellOptions = {
    appName: 'test-app',
    repoUrl: 'https://github.com/example/test-app.git',
    stackType: 'node',
  };

  beforeEach(() => {
    mockDocker = createMockDocker();
    manager = new CellManager(mockDocker as unknown as ConstructorParameters<typeof CellManager>[0]);
  });

  // ─── ping ────────────────────────────────────────────────────────────────

  describe('ping', () => {
    test('succeeds when Docker is available', async () => {
      await expect(manager.ping()).resolves.toBeUndefined();
    });

    test('throws DockerNotAvailableError when Docker is down', async () => {
      mockDocker._setPingWorks(false);
      await expect(manager.ping()).rejects.toThrow(DockerNotAvailableError);
    });
  });

  // ─── createCell ──────────────────────────────────────────────────────────

  describe('createCell', () => {
    test('creates a container and volume for a node app', async () => {
      const cellRef = await manager.createCell(defaultOptions);

      expect(cellRef.cellId).toBe('meta-vibecoding-test-app');
      expect(cellRef.workDir).toBe('/workspace');
      expect(cellRef.stackType).toBe('node');
      expect(mockDocker.createVolume).toHaveBeenCalledTimes(1);
      expect(mockDocker.createContainer).toHaveBeenCalledTimes(1);
    });

    test('creates a cell for python stack', async () => {
      const cellRef = await manager.createCell({ ...defaultOptions, stackType: 'python' });
      expect(cellRef.stackType).toBe('python');
    });

    test('creates a cell for rust stack', async () => {
      const cellRef = await manager.createCell({ ...defaultOptions, stackType: 'rust' });
      expect(cellRef.stackType).toBe('rust');
    });

    test('throws CellAlreadyExistsError if container exists', async () => {
      // Create first cell
      await manager.createCell(defaultOptions);

      // Try to create again
      await expect(manager.createCell(defaultOptions)).rejects.toThrow(CellAlreadyExistsError);
    });

    test('throws ImageNotFoundError if base image missing', async () => {
      mockDocker._images.clear();
      await expect(manager.createCell(defaultOptions)).rejects.toThrow(ImageNotFoundError);
    });

    test('throws DockerNotAvailableError if Docker is down', async () => {
      mockDocker._setPingWorks(false);
      await expect(manager.createCell(defaultOptions)).rejects.toThrow(DockerNotAvailableError);
    });

    test('passes environment variables to the container', async () => {
      await manager.createCell({
        ...defaultOptions,
        env: { GIT_TOKEN: 'secret123', NODE_ENV: 'production' },
      });

      const createCall = mockDocker.createContainer.mock.calls[0];
      const opts = createCall[0] as { Env: string[] };
      expect(opts.Env).toContain('GIT_TOKEN=secret123');
      expect(opts.Env).toContain('NODE_ENV=production');
    });

    test('configures port mapping when hostPort provided', async () => {
      await manager.createCell({ ...defaultOptions, hostPort: 8080 });

      const createCall = mockDocker.createContainer.mock.calls[0];
      const opts = createCall[0] as unknown as { ExposedPorts: Record<string, object>; HostConfig: { PortBindings: Record<string, Array<{ HostPort: string }>> } };
      expect(opts.ExposedPorts).toHaveProperty('3000/tcp');
      expect(opts.HostConfig.PortBindings['3000/tcp']).toEqual([{ HostPort: '8080' }]);
    });

    test('sets correct labels on the container', async () => {
      await manager.createCell(defaultOptions);

      const createCall = mockDocker.createContainer.mock.calls[0];
      const opts = createCall[0] as { Labels: Record<string, string> };
      expect(opts.Labels['meta-vibecoding.app']).toBe('test-app');
      expect(opts.Labels['meta-vibecoding.stack']).toBe('node');
      expect(opts.Labels['meta-vibecoding.managed']).toBe('true');
    });

    test('container is stopped after creation (ready for startCell)', async () => {
      await manager.createCell(defaultOptions);

      // Container should exist but be stopped
      const state = mockDocker._containers.get('meta-vibecoding-test-app');
      expect(state).toBeDefined();
      expect(state!.running).toBe(false);
    });
  });

  // ─── startCell ───────────────────────────────────────────────────────────

  describe('startCell', () => {
    test('starts a stopped cell', async () => {
      await manager.createCell(defaultOptions);
      await manager.startCell('test-app');

      const state = mockDocker._containers.get('meta-vibecoding-test-app');
      expect(state!.running).toBe(true);
    });

    test('is a no-op if already running', async () => {
      await manager.createCell(defaultOptions);
      await manager.startCell('test-app');
      // Should not throw
      await manager.startCell('test-app');
    });

    test('throws CellNotFoundError for unknown app', async () => {
      await expect(manager.startCell('unknown-app')).rejects.toThrow(CellNotFoundError);
    });

    test('throws DockerNotAvailableError if Docker is down', async () => {
      mockDocker._setPingWorks(false);
      await expect(manager.startCell('test-app')).rejects.toThrow(DockerNotAvailableError);
    });
  });

  // ─── stopCell ────────────────────────────────────────────────────────────

  describe('stopCell', () => {
    test('stops a running cell', async () => {
      await manager.createCell(defaultOptions);
      await manager.startCell('test-app');
      await manager.stopCell('test-app');

      const state = mockDocker._containers.get('meta-vibecoding-test-app');
      expect(state!.running).toBe(false);
    });

    test('is a no-op if already stopped', async () => {
      await manager.createCell(defaultOptions);
      // Cell is stopped after creation, should not throw
      await manager.stopCell('test-app');
    });

    test('throws CellNotFoundError for unknown app', async () => {
      await expect(manager.stopCell('unknown-app')).rejects.toThrow(CellNotFoundError);
    });
  });

  // ─── destroyCell ─────────────────────────────────────────────────────────

  describe('destroyCell', () => {
    test('removes container and volume with confirm=true', async () => {
      await manager.createCell(defaultOptions);
      await manager.destroyCell('test-app', { confirm: true });

      expect(mockDocker._containers.has('meta-vibecoding-test-app')).toBe(false);
      expect(mockDocker._volumes.has('meta-vibecoding-test-app-data')).toBe(false);
    });

    test('throws error when confirm=false', async () => {
      await manager.createCell(defaultOptions);
      await expect(
        manager.destroyCell('test-app', { confirm: false })
      ).rejects.toThrow('confirm=true');
    });

    test('succeeds even if container does not exist', async () => {
      await expect(
        manager.destroyCell('nonexistent', { confirm: true })
      ).resolves.toBeUndefined();
    });

    test('throws DockerNotAvailableError if Docker is down', async () => {
      mockDocker._setPingWorks(false);
      await expect(
        manager.destroyCell('test-app', { confirm: true })
      ).rejects.toThrow(DockerNotAvailableError);
    });
  });

  // ─── getCellStatus ───────────────────────────────────────────────────────

  describe('getCellStatus', () => {
    test('returns running status for running cell', async () => {
      await manager.createCell(defaultOptions);
      await manager.startCell('test-app');

      const status = await manager.getCellStatus('test-app');
      expect(status.state).toBe('running');
      if (status.state === 'running') {
        expect(status.startedAt).toBeTruthy();
      }
    });

    test('returns stopped status for stopped cell', async () => {
      await manager.createCell(defaultOptions);
      await manager.startCell('test-app');
      await manager.stopCell('test-app');

      const status = await manager.getCellStatus('test-app');
      expect(status.state).toBe('stopped');
    });

    test('returns not_found for nonexistent cell', async () => {
      const status = await manager.getCellStatus('nonexistent');
      expect(status.state).toBe('not_found');
    });

    test('returns error when Docker is down', async () => {
      mockDocker._setPingWorks(false);
      const status = await manager.getCellStatus('test-app');
      expect(status.state).toBe('error');
    });
  });

  // ─── listCells ───────────────────────────────────────────────────────────

  describe('listCells', () => {
    test('returns empty list when no cells exist', async () => {
      const cells = await manager.listCells();
      expect(cells).toEqual([]);
    });

    test('lists all managed cells', async () => {
      await manager.createCell(defaultOptions);
      await manager.createCell({ ...defaultOptions, appName: 'app-two', stackType: 'python' });

      const cells = await manager.listCells();
      expect(cells).toHaveLength(2);
      expect(cells.map(c => c.appName).sort()).toEqual(['app-two', 'test-app']);
    });

    test('includes correct stack type for each cell', async () => {
      await manager.createCell({ ...defaultOptions, appName: 'node-app', stackType: 'node' });
      await manager.createCell({ ...defaultOptions, appName: 'py-app', stackType: 'python' });
      await manager.createCell({ ...defaultOptions, appName: 'rs-app', stackType: 'rust' });

      const cells = await manager.listCells();
      const stackMap = Object.fromEntries(cells.map(c => [c.appName, c.stackType]));
      expect(stackMap['node-app']).toBe('node');
      expect(stackMap['py-app']).toBe('python');
      expect(stackMap['rs-app']).toBe('rust');
    });
  });

  // ─── getCellRef ──────────────────────────────────────────────────────────

  describe('getCellRef', () => {
    test('returns CellRef for existing cell', async () => {
      await manager.createCell(defaultOptions);
      const cellRef = await manager.getCellRef('test-app');

      expect(cellRef).toBeDefined();
      expect(cellRef!.cellId).toBe('meta-vibecoding-test-app');
      expect(cellRef!.workDir).toBe('/workspace');
      expect(cellRef!.stackType).toBe('node');
    });

    test('returns undefined for nonexistent cell', async () => {
      const cellRef = await manager.getCellRef('nonexistent');
      expect(cellRef).toBeUndefined();
    });
  });

  // ─── execInCell ──────────────────────────────────────────────────────────

  describe('execInCell', () => {
    test('executes a command in a running cell', async () => {
      await manager.createCell(defaultOptions);
      await manager.startCell('test-app');

      const result = await manager.execInCell('test-app', ['echo', 'hello']);
      expect(result.exitCode).toBe(0);
    });

    test('throws error if cell is not running', async () => {
      await manager.createCell(defaultOptions);
      await expect(
        manager.execInCell('test-app', ['echo', 'hello'])
      ).rejects.toThrow('not running');
    });

    test('throws CellNotFoundError for unknown cell', async () => {
      await expect(
        manager.execInCell('unknown', ['echo', 'hello'])
      ).rejects.toThrow(CellNotFoundError);
    });
  });

  // ─── Error types ─────────────────────────────────────────────────────────

  describe('error types', () => {
    test('DockerNotAvailableError has correct name', () => {
      const err = new DockerNotAvailableError();
      expect(err.name).toBe('DockerNotAvailableError');
      expect(err.message).toContain('Docker daemon');
    });

    test('ImageNotFoundError has correct name and message', () => {
      const err = new ImageNotFoundError('test:latest');
      expect(err.name).toBe('ImageNotFoundError');
      expect(err.message).toContain('test:latest');
      expect(err.message).toContain('build:images');
    });

    test('CellNotFoundError has correct name', () => {
      const err = new CellNotFoundError('my-app');
      expect(err.name).toBe('CellNotFoundError');
      expect(err.message).toContain('my-app');
    });

    test('CellAlreadyExistsError has correct name', () => {
      const err = new CellAlreadyExistsError('my-app');
      expect(err.name).toBe('CellAlreadyExistsError');
      expect(err.message).toContain('my-app');
    });
  });

  // ─── Full lifecycle ──────────────────────────────────────────────────────

  describe('full lifecycle', () => {
    test('create → start → exec → stop → destroy', async () => {
      // Create
      const cellRef = await manager.createCell(defaultOptions);
      expect(cellRef.cellId).toBe('meta-vibecoding-test-app');

      // Start
      await manager.startCell('test-app');
      let status = await manager.getCellStatus('test-app');
      expect(status.state).toBe('running');

      // Exec
      const result = await manager.execInCell('test-app', ['npm', 'test']);
      expect(result.exitCode).toBe(0);

      // Stop
      await manager.stopCell('test-app');
      status = await manager.getCellStatus('test-app');
      expect(status.state).toBe('stopped');

      // Destroy
      await manager.destroyCell('test-app', { confirm: true });
      status = await manager.getCellStatus('test-app');
      expect(status.state).toBe('not_found');
    });
  });
});
