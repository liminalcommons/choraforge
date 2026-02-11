/**
 * ABOUTME: Docker Cell Manager for the Meta-Vibecoding platform.
 * Manages the full lifecycle of Docker containers ("cells") for each app.
 * Each cell runs in isolation with its own volume, cloned repo, and agent process.
 */

import Docker from 'dockerode';
import type { Container, ContainerInfo } from 'dockerode';
import type { CellRef } from './agent-adapter.js';
import type { StackType } from './registry.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Status of a cell as reported by Docker. */
export type CellStatus =
  | { state: 'running'; startedAt: string }
  | { state: 'stopped'; finishedAt: string }
  | { state: 'error'; error: string }
  | { state: 'not_found' };

/** Options for creating a new cell. */
export interface CreateCellOptions {
  /** Unique app name (used in container/volume naming) */
  appName: string;
  /** Git repository URL to clone into the cell */
  repoUrl: string;
  /** Stack type determines which base image to use */
  stackType: StackType;
  /** Optional git branch to clone (default: main) */
  branch?: string;
  /** Environment variables to inject into the container */
  env?: Record<string, string>;
  /** Optional host port to expose (maps to container port 3000) */
  hostPort?: number;
}

/** Options for starting a cell. */
export interface StartCellOptions {
  /** Command to run inside the container (default: sleep infinity for agent attachment) */
  cmd?: string[];
  /** Additional environment variables for this start */
  env?: Record<string, string>;
}

/** Options for destroying a cell. */
export interface DestroyCellOptions {
  /** Must be true to actually destroy — safety flag */
  confirm: boolean;
  /** Force removal even if running */
  force?: boolean;
}

/** Docker image name for each stack type. */
const STACK_IMAGES: Record<StackType, string> = {
  node: 'meta-vibecoding/cell-node:latest',
  python: 'meta-vibecoding/cell-python:latest',
  rust: 'meta-vibecoding/cell-rust:latest',
};

/** Container name prefix for meta-vibecoding cells. */
const CONTAINER_PREFIX = 'meta-vibecoding';

/** Working directory inside the container. */
const CELL_WORKDIR = '/workspace';

// ─── Errors ──────────────────────────────────────────────────────────────────

export class DockerNotAvailableError extends Error {
  constructor(cause?: unknown) {
    super('Docker daemon is not running or not accessible');
    this.name = 'DockerNotAvailableError';
    this.cause = cause;
  }
}

export class ImageNotFoundError extends Error {
  constructor(image: string) {
    super(`Docker image not found: ${image}. Run 'bun run build:images' to build base images.`);
    this.name = 'ImageNotFoundError';
  }
}

export class CellNotFoundError extends Error {
  constructor(appName: string) {
    super(`Cell not found for app: ${appName}`);
    this.name = 'CellNotFoundError';
  }
}

export class CellAlreadyExistsError extends Error {
  constructor(appName: string) {
    super(`Cell already exists for app: ${appName}`);
    this.name = 'CellAlreadyExistsError';
  }
}

export class PortConflictError extends Error {
  constructor(port: number) {
    super(`Port ${port} is already in use`);
    this.name = 'PortConflictError';
  }
}

// ─── Cell Manager ────────────────────────────────────────────────────────────

/**
 * Manages Docker container lifecycle for meta-vibecoding app cells.
 *
 * Each cell = 1 container + 1 volume. Container names follow the pattern
 * `meta-vibecoding-{appName}`, volumes follow `meta-vibecoding-{appName}-data`.
 */
export class CellManager {
  private docker: Docker;

  constructor(docker?: Docker) {
    this.docker = docker ?? new Docker();
  }

  /**
   * Verify that the Docker daemon is accessible.
   * @throws DockerNotAvailableError if Docker is not running.
   */
  async ping(): Promise<void> {
    try {
      await this.docker.ping();
    } catch (err) {
      throw new DockerNotAvailableError(err);
    }
  }

  /**
   * Create a new cell: Docker volume + container with cloned repo.
   *
   * 1. Checks Docker is available
   * 2. Verifies base image exists
   * 3. Creates a named volume
   * 4. Creates the container with the volume mounted
   * 5. Clones the git repo into /workspace inside the container
   *
   * @returns CellRef pointing to the new cell
   */
  async createCell(options: CreateCellOptions): Promise<CellRef> {
    await this.ping();

    const containerName = this.containerName(options.appName);
    const volumeName = this.volumeName(options.appName);
    const image = STACK_IMAGES[options.stackType];

    // Check if cell already exists
    if (await this.containerExists(containerName)) {
      throw new CellAlreadyExistsError(options.appName);
    }

    // Verify base image exists
    await this.verifyImage(image);

    // Create volume
    await this.docker.createVolume({ Name: volumeName });

    // Build env vars array
    const envArray = this.buildEnvArray(options.env);

    // Build port bindings
    const portBindings: Record<string, Array<{ HostPort: string }>> = {};
    const exposedPorts: Record<string, object> = {};
    if (options.hostPort) {
      exposedPorts['3000/tcp'] = {};
      portBindings['3000/tcp'] = [{ HostPort: String(options.hostPort) }];
    }

    // Create container
    const container = await this.docker.createContainer({
      name: containerName,
      Image: image,
      Env: envArray,
      WorkingDir: CELL_WORKDIR,
      ExposedPorts: exposedPorts,
      HostConfig: {
        Binds: [`${volumeName}:${CELL_WORKDIR}`],
        PortBindings: portBindings,
        RestartPolicy: { Name: 'no' },
      },
      Labels: {
        'meta-vibecoding.app': options.appName,
        'meta-vibecoding.stack': options.stackType,
        'meta-vibecoding.managed': 'true',
      },
      // Start with bash so we can exec git clone into it
      Cmd: ['sleep', 'infinity'],
    });

    // Start container to clone the repo
    await container.start();

    // Clone the git repo into /workspace
    const branch = options.branch ?? 'main';
    try {
      const exec = await container.exec({
        Cmd: ['git', 'clone', '--branch', branch, '--single-branch', '--depth', '1', options.repoUrl, '.'],
        WorkingDir: CELL_WORKDIR,
        AttachStdout: true,
        AttachStderr: true,
      });
      const stream = await exec.start({ Detach: false });
      // Wait for clone to complete
      await new Promise<void>((resolve, reject) => {
        stream.on('end', resolve);
        stream.on('error', reject);
      });

      // Check exit code
      const execInspect = await exec.inspect();
      if (execInspect.ExitCode !== 0) {
        // Cleanup on failure
        await container.stop().catch(() => {});
        await container.remove({ force: true }).catch(() => {});
        await this.docker.getVolume(volumeName).remove().catch(() => {});
        throw new Error(`Git clone failed with exit code ${execInspect.ExitCode}`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Git clone failed')) {
        throw err;
      }
      // Cleanup on unexpected error
      await container.stop().catch(() => {});
      await container.remove({ force: true }).catch(() => {});
      await this.docker.getVolume(volumeName).remove().catch(() => {});
      throw new Error(`Failed to clone repository: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Stop container after clone (will be started explicitly via startCell)
    await container.stop();

    return {
      cellId: containerName,
      workDir: CELL_WORKDIR,
      stackType: options.stackType,
    };
  }

  /**
   * Start a cell's container.
   * If the container is already running, this is a no-op.
   */
  async startCell(appName: string, options?: StartCellOptions): Promise<void> {
    await this.ping();

    const containerName = this.containerName(appName);
    const container = await this.getContainer(containerName, appName);
    const info = await container.inspect();

    if (info.State.Running) {
      return; // Already running
    }

    // Apply additional env vars if provided
    if (options?.env) {
      // We need to recreate with updated env — Docker doesn't support updating env on existing container
      // For now, start as-is. Env changes require recreating the cell.
    }

    await container.start();

    // If a custom command is specified, exec it
    if (options?.cmd && options.cmd.length > 0) {
      const exec = await container.exec({
        Cmd: options.cmd,
        WorkingDir: CELL_WORKDIR,
      });
      await exec.start({ Detach: true });
    }
  }

  /**
   * Gracefully stop a cell's container.
   * Sends SIGTERM, waits up to 30s, then SIGKILL.
   */
  async stopCell(appName: string): Promise<void> {
    await this.ping();

    const containerName = this.containerName(appName);
    const container = await this.getContainer(containerName, appName);
    const info = await container.inspect();

    if (!info.State.Running) {
      return; // Already stopped
    }

    // 30 second grace period for SIGTERM before SIGKILL
    await container.stop({ t: 30 });
  }

  /**
   * Destroy a cell: remove the container and its volume.
   * Requires confirm=true as a safety flag.
   */
  async destroyCell(appName: string, options: DestroyCellOptions): Promise<void> {
    if (!options.confirm) {
      throw new Error('destroyCell requires confirm=true to prevent accidental data loss');
    }

    await this.ping();

    const containerName = this.containerName(appName);
    const volumeName = this.volumeName(appName);

    // Remove container (force if requested or if running)
    try {
      const container = this.docker.getContainer(containerName);
      await container.remove({ force: options.force ?? true });
    } catch (err) {
      // Container might not exist — that's fine
      if (!this.isNotFoundError(err)) {
        throw err;
      }
    }

    // Remove volume
    try {
      const volume = this.docker.getVolume(volumeName);
      await volume.remove();
    } catch (err) {
      // Volume might not exist — that's fine
      if (!this.isNotFoundError(err)) {
        throw err;
      }
    }
  }

  /**
   * Get the status of a cell.
   */
  async getCellStatus(appName: string): Promise<CellStatus> {
    try {
      await this.ping();
    } catch {
      return { state: 'error', error: 'Docker daemon not available' };
    }

    const containerName = this.containerName(appName);

    try {
      const container = this.docker.getContainer(containerName);
      const info = await container.inspect();

      if (info.State.Running) {
        return { state: 'running', startedAt: info.State.StartedAt };
      }

      if (info.State.ExitCode !== 0 && info.State.ExitCode !== undefined) {
        return { state: 'error', error: `Exited with code ${info.State.ExitCode}: ${info.State.Error || 'unknown'}` };
      }

      return { state: 'stopped', finishedAt: info.State.FinishedAt };
    } catch (err) {
      if (this.isNotFoundError(err)) {
        return { state: 'not_found' };
      }
      return { state: 'error', error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * List all meta-vibecoding cells.
   */
  async listCells(): Promise<Array<{ appName: string; stackType: StackType; state: string }>> {
    await this.ping();

    const containers = await this.docker.listContainers({
      all: true,
      filters: { label: ['meta-vibecoding.managed=true'] },
    });

    return containers.map((c: ContainerInfo) => ({
      appName: c.Labels['meta-vibecoding.app'] ?? 'unknown',
      stackType: (c.Labels['meta-vibecoding.stack'] ?? 'node') as StackType,
      state: c.State,
    }));
  }

  /**
   * Execute a command inside a running cell.
   * Useful for running agent processes, build commands, etc.
   */
  async execInCell(
    appName: string,
    cmd: string[],
    options?: { workDir?: string; env?: string[]; detach?: boolean }
  ): Promise<{ exitCode: number; output: string }> {
    await this.ping();

    const containerName = this.containerName(appName);
    const container = await this.getContainer(containerName, appName);
    const info = await container.inspect();

    if (!info.State.Running) {
      throw new Error(`Cell ${appName} is not running. Start it first.`);
    }

    const exec = await container.exec({
      Cmd: cmd,
      WorkingDir: options?.workDir ?? CELL_WORKDIR,
      Env: options?.env,
      AttachStdout: true,
      AttachStderr: true,
    });

    if (options?.detach) {
      await exec.start({ Detach: true });
      return { exitCode: 0, output: '' };
    }

    const stream = await exec.start({ Detach: false });
    let output = '';

    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    const execInspect = await exec.inspect();
    return {
      exitCode: execInspect.ExitCode ?? -1,
      output,
    };
  }

  /**
   * Get a CellRef for an existing cell.
   */
  async getCellRef(appName: string): Promise<CellRef | undefined> {
    const containerName = this.containerName(appName);

    try {
      const container = this.docker.getContainer(containerName);
      const info = await container.inspect();

      const stackType = (info.Config.Labels['meta-vibecoding.stack'] ?? 'node') as StackType;

      return {
        cellId: containerName,
        workDir: CELL_WORKDIR,
        stackType,
      };
    } catch (err) {
      if (this.isNotFoundError(err)) {
        return undefined;
      }
      throw err;
    }
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  private containerName(appName: string): string {
    return `${CONTAINER_PREFIX}-${appName}`;
  }

  private volumeName(appName: string): string {
    return `${CONTAINER_PREFIX}-${appName}-data`;
  }

  private buildEnvArray(env?: Record<string, string>): string[] {
    if (!env) return [];
    return Object.entries(env).map(([k, v]) => `${k}=${v}`);
  }

  private async containerExists(containerName: string): Promise<boolean> {
    try {
      const container = this.docker.getContainer(containerName);
      await container.inspect();
      return true;
    } catch (err) {
      if (this.isNotFoundError(err)) {
        return false;
      }
      throw err;
    }
  }

  private async getContainer(containerName: string, appName: string): Promise<Container> {
    const container = this.docker.getContainer(containerName);
    try {
      await container.inspect();
      return container;
    } catch (err) {
      if (this.isNotFoundError(err)) {
        throw new CellNotFoundError(appName);
      }
      throw err;
    }
  }

  private async verifyImage(image: string): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();
    } catch (err) {
      if (this.isNotFoundError(err)) {
        throw new ImageNotFoundError(image);
      }
      throw err;
    }
  }

  private isNotFoundError(err: unknown): boolean {
    if (err && typeof err === 'object' && 'statusCode' in err) {
      return (err as { statusCode: number }).statusCode === 404;
    }
    return false;
  }
}
