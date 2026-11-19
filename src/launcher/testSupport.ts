import { EventEmitter } from 'node:events';
import type { ManagedChild } from './ownedProcesses';

/** In-memory stand-in for a child process, for launcher tests. */
export class FakeChild extends EventEmitter implements ManagedChild {
  readonly pid = 4242;
  exitCode: number | null = null;
  readonly signalCode = null;
  readonly sent: string[] = [];
  readonly signals: Array<NodeJS.Signals | undefined> = [];

  constructor(
    readonly connected: boolean,
    private readonly exitsWhenAsked: boolean,
  ) {
    super();
  }

  send(message: string): boolean {
    this.sent.push(message);
    if (this.exitsWhenAsked) queueMicrotask(() => this.exit(0));
    return true;
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(signal);
    if (this.exitsWhenAsked) queueMicrotask(() => this.exit(0));
    return true;
  }

  exit(code: number): void {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    this.emit('exit', code);
  }
}
