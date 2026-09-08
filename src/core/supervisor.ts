import { execSync, spawn } from 'node:child_process';
import { logger } from '../utils/logger.js';

export interface SupervisedProcess {
  pid: number;
  name: string;
  startTime: Date;
}

export class ProcessSupervisor {
  private static instance: ProcessSupervisor | null = null;
  private trackedProcesses: Map<number, SupervisedProcess> = new Map();
  private hooksRegistered: boolean = false;

  private constructor() {
    this.registerGlobalHooks();
  }

  static getInstance(): ProcessSupervisor {
    if (!ProcessSupervisor.instance) {
      ProcessSupervisor.instance = new ProcessSupervisor();
    }
    return ProcessSupervisor.instance;
  }

  /**
   * Registers a child PID under supervision.
   */
  track(pid: number, name: string): void {
    if (!pid || pid <= 0) return;
    this.trackedProcesses.set(pid, {
      pid,
      name,
      startTime: new Date(),
    });
    logger.debug(`Supervising process ${name} (PID: ${pid})`);
  }

  /**
   * Unregisters a child PID (e.g., normal graceful exit).
   */
  untrack(pid: number): void {
    this.trackedProcesses.delete(pid);
    logger.debug(`Untracked process PID: ${pid}`);
  }

  /**
   * Kills an entire process tree for a given root PID.
   * Cross-platform: handles Windows taskkill /T /F and POSIX process group kills.
   */
  killProcessTree(pid: number, name?: string): void {
    if (!pid || pid <= 0) return;
    const procName = name ?? this.trackedProcesses.get(pid)?.name ?? 'unknown';

    logger.debug(`Terminating process tree for ${procName} (PID: ${pid})`);

    try {
      if (process.platform === 'win32') {
        // Windows: /T kills entire child tree, /F forces termination
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
      } else {
        // POSIX: try process group first, fallback to individual kill
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          process.kill(pid, 'SIGKILL');
        }
      }
    } catch {
      // Process may already be dead
    } finally {
      this.untrack(pid);
    }
  }

  /**
   * Shuts down all supervised processes cleanly.
   */
  shutdownAll(): void {
    if (this.trackedProcesses.size === 0) return;

    logger.info(`Shutting down ${this.trackedProcesses.size} supervised processes...`);
    for (const [pid, proc] of this.trackedProcesses.entries()) {
      this.killProcessTree(pid, proc.name);
    }
    this.trackedProcesses.clear();
  }

  /**
   * Returns list of currently tracked processes.
   */
  getTrackedProcesses(): SupervisedProcess[] {
    return Array.from(this.trackedProcesses.values());
  }

  private registerGlobalHooks(): void {
    if (this.hooksRegistered) return;
    this.hooksRegistered = true;

    const cleanup = () => {
      this.shutdownAll();
    };

    process.on('exit', cleanup);

    const handleSignal = (signal: NodeJS.Signals) => {
      // If higher-level handlers (e.g., startCommand) are registered,
      // let them manage graceful asynchronous shutdown.
      if (process.listenerCount(signal) > 1) {
        return;
      }
      cleanup();
      process.exit(0);
    };

    process.on('SIGINT', () => handleSignal('SIGINT'));
    process.on('SIGTERM', () => handleSignal('SIGTERM'));
  }
}

export const supervisor = ProcessSupervisor.getInstance();
