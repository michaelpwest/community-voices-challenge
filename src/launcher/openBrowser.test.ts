import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { browserCommand, openBrowser } from './openBrowser';

const URL = 'http://localhost:3000';

type Outcome = { exit: number | null } | { error: Error } | 'keeps running';

/** A stand-in for spawn whose child exits, fails to start, or keeps running. */
function fakeSpawn(outcome: Outcome) {
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
  const spawnFn = vi.fn(() => {
    queueMicrotask(() => {
      if (outcome === 'keeps running') return;
      if ('error' in outcome) child.emit('error', outcome.error);
      else child.emit('exit', outcome.exit);
    });
    return child;
  });
  return { spawnFn: spawnFn as unknown as typeof spawn, calls: spawnFn, child };
}

const open = (outcome: Outcome, platform: NodeJS.Platform = 'linux') => {
  const fake = fakeSpawn(outcome);
  return { ...fake, opened: openBrowser(URL, { spawnFn: fake.spawnFn, platform, settleMs: 20 }) };
};

describe('browserCommand', () => {
  it('uses each operating system’s own command', () => {
    expect(browserCommand(URL, 'win32')).toEqual({ command: 'cmd', args: ['/c', 'start', '', URL] });
    expect(browserCommand(URL, 'darwin')).toEqual({ command: 'open', args: [URL] });
    expect(browserCommand(URL, 'linux')).toEqual({ command: 'xdg-open', args: [URL] });
  });
});

describe('openBrowser', () => {
  it('reports success when the open command finishes cleanly', async () => {
    const { opened, calls, child } = open({ exit: 0 }, 'darwin');
    expect(await opened).toBe(true);
    expect(calls).toHaveBeenCalledWith('open', [URL], { stdio: 'ignore', detached: true, windowsHide: true });
    expect(child.unref).toHaveBeenCalled();
  });

  it('reports failure when the open command starts but exits with an error', async () => {
    // xdg-open exits with 3 or 4 when there is no display or no default browser.
    expect(await open({ exit: 3 }).opened).toBe(false);
    expect(await open({ exit: 4 }).opened).toBe(false);
  });

  it('reports failure when the open command is stopped by a signal', async () => {
    expect(await open({ exit: null }).opened).toBe(false);
  });

  it('reports failure when the system has no such command', async () => {
    expect(await open({ error: new Error('spawn xdg-open ENOENT') }).opened).toBe(false);
  });

  it('assumes success when the open command is still running after the wait', async () => {
    const { opened, child } = open('keeps running');
    expect(await opened).toBe(true);
    expect(child.unref).toHaveBeenCalled();
  });

  it('reports failure when starting the command throws', async () => {
    const throwing = (() => {
      throw new Error('spawn failed');
    }) as unknown as typeof spawn;
    expect(await openBrowser(URL, { spawnFn: throwing, platform: 'linux' })).toBe(false);
  });
});
