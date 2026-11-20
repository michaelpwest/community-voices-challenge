import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { browserCommand, openBrowser } from './openBrowser';

const URL = 'http://localhost:3000';

/** A stand-in for spawn that reports either a successful start or a failure. */
function fakeSpawn(outcome: 'spawn' | 'error') {
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
  const spawnFn = vi.fn(() => {
    queueMicrotask(() => child.emit(outcome, new Error('not found')));
    return child;
  });
  return { spawnFn: spawnFn as unknown as typeof spawn, calls: spawnFn, child };
}

describe('browserCommand', () => {
  it('uses each operating system’s own command', () => {
    expect(browserCommand(URL, 'win32')).toEqual({ command: 'cmd', args: ['/c', 'start', '', URL] });
    expect(browserCommand(URL, 'darwin')).toEqual({ command: 'open', args: [URL] });
    expect(browserCommand(URL, 'linux')).toEqual({ command: 'xdg-open', args: [URL] });
  });
});

describe('openBrowser', () => {
  it('starts the command without tying the browser to the launcher', async () => {
    const { spawnFn, calls, child } = fakeSpawn('spawn');
    expect(await openBrowser(URL, spawnFn, 'darwin')).toBe(true);
    expect(calls).toHaveBeenCalledWith('open', [URL], { stdio: 'ignore', detached: true, windowsHide: true });
    expect(child.unref).toHaveBeenCalled();
  });

  it('reports failure when the system has no such command', async () => {
    const { spawnFn } = fakeSpawn('error');
    expect(await openBrowser(URL, spawnFn, 'linux')).toBe(false);
  });

  it('reports failure when starting the command throws', async () => {
    const throwing = (() => {
      throw new Error('spawn failed');
    }) as unknown as typeof spawn;
    expect(await openBrowser(URL, throwing, 'linux')).toBe(false);
  });
});
