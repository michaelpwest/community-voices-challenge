import { spawnSync } from 'node:child_process';
import { SHUTDOWN_MESSAGE } from '../shared/processProtocol';

/** The subset of ChildProcess the launcher relies on (kept small so tests can fake it). */
export interface ManagedChild {
  readonly pid?: number;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  readonly connected: boolean;
  send(message: string): boolean;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'exit', listener: (code: number | null) => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
}

export type UnexpectedExitHandler = (name: string, detail: string) => void;

export interface OwnedProcessesOptions {
  forceKill?: (child: ManagedChild) => void;
  graceMs?: number;
  platform?: NodeJS.Platform;
}

function forceKillProcess(child: ManagedChild): void {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    // kill() ends a single process on Windows; /T also ends anything it spawned.
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGKILL');
  }
}

function hasExited(child: ManagedChild): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/** Resolves true if `gone` settles within the limit, false on timeout. */
function settlesWithin(gone: Promise<void>, limitMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), limitMs);
    void gone.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

interface Entry {
  child: ManagedChild;
  stopping: boolean;
  gone: Promise<void>;
}

/**
 * Tracks the child processes this launcher started. Shutdown goes through
 * this registry only, so processes that were already running (such as a
 * pre-existing Ollama server) are never touched.
 */
export class OwnedProcesses {
  private readonly entries = new Map<string, Entry>();
  private readonly forceKill: (child: ManagedChild) => void;
  private readonly graceMs: number;
  private readonly platform: NodeJS.Platform;

  constructor(options: OwnedProcessesOptions = {}) {
    this.forceKill = options.forceKill ?? forceKillProcess;
    this.graceMs = options.graceMs ?? 3000;
    this.platform = options.platform ?? process.platform;
  }

  add(name: string, child: ManagedChild, onUnexpectedExit?: UnexpectedExitHandler): void {
    const gone = new Promise<void>((resolve) => {
      const finish = (detail: string): void => {
        if (this.entries.get(name) === entry) this.entries.delete(name);
        if (!entry.stopping) onUnexpectedExit?.(name, detail);
        resolve();
      };
      child.once('exit', (code) => finish(`exit code ${code ?? 'unknown'}`));
      child.once('error', (error) => finish(error.message));
    });
    const entry: Entry = { child, stopping: false, gone };
    this.entries.set(name, entry);
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  async stop(name: string): Promise<void> {
    const entry = this.entries.get(name);
    if (!entry) return;
    entry.stopping = true;
    if (hasExited(entry.child)) {
      this.entries.delete(name);
      return;
    }
    const exitedInTime = this.requestExit(entry.child) && (await settlesWithin(entry.gone, this.graceMs));
    if (!exitedInTime) {
      this.forceKill(entry.child);
      await settlesWithin(entry.gone, this.graceMs);
    }
    this.entries.delete(name);
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.names().map((name) => this.stop(name)));
  }

  /** Asks a child to exit cleanly. Returns false when the platform offers no way to ask. */
  private requestExit(child: ManagedChild): boolean {
    try {
      if (child.connected) return child.send(SHUTDOWN_MESSAGE);
      if (this.platform !== 'win32') return child.kill('SIGTERM');
    } catch {
      // The child went away between the check and the request.
    }
    return false;
  }
}
