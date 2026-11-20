import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { browserCommand, interpretExit, openBrowser } from './openBrowser';

const URL = 'http://localhost:3000';

/** A stand-in for spawn. The test decides what the child reports, and when. */
function fakeSpawn() {
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
  const spawnFn = vi.fn(() => child);
  return { spawnFn: spawnFn as unknown as typeof spawn, calls: spawnFn, child };
}

function open(platform: NodeJS.Platform = 'linux') {
  const fake = fakeSpawn();
  return { ...fake, result: openBrowser(URL, { spawnFn: fake.spawnFn, platform }) };
}

describe('browserCommand', () => {
  it('uses each operating system’s own command', () => {
    expect(browserCommand(URL, 'win32')).toEqual({ command: 'cmd', args: ['/c', 'start', '', URL] });
    expect(browserCommand(URL, 'darwin')).toEqual({ command: 'open', args: [URL] });
    expect(browserCommand(URL, 'linux')).toEqual({ command: 'xdg-open', args: [URL] });
  });
});

describe('interpretExit', () => {
  it('reads a clean exit as opened on every system', () => {
    expect(interpretExit(0, 'win32')).toBe('opened');
    expect(interpretExit(0, 'darwin')).toBe('opened');
    expect(interpretExit(0, 'linux')).toBe('opened');
  });

  it('reads any error exit as failed on Windows and macOS', () => {
    expect(interpretExit(1, 'win32')).toBe('failed');
    expect(interpretExit(1, 'darwin')).toBe('failed');
    expect(interpretExit(null, 'darwin')).toBe('failed');
  });

  it('reads only xdg-open’s own failure codes as failed on Linux', () => {
    expect(interpretExit(3, 'linux')).toBe('failed');
    expect(interpretExit(4, 'linux')).toBe('failed');
  });

  it('does not treat a browser’s own exit code, passed on by xdg-open, as a failure to open', () => {
    expect(interpretExit(1, 'linux')).toBe('unclear');
    expect(interpretExit(127, 'linux')).toBe('unclear');
    expect(interpretExit(null, 'linux')).toBe('unclear');
  });
});

describe('openBrowser', () => {
  it('starts the command detached and does not hold on to it', async () => {
    const { result, calls, child } = open('darwin');
    child.emit('exit', 0);
    expect(await result).toBe('opened');
    expect(calls).toHaveBeenCalledWith('open', [URL], { stdio: 'ignore', detached: true, windowsHide: true });
    expect(child.unref).toHaveBeenCalled();
  });

  it('reports failure when the command starts but cannot open a browser', async () => {
    const { result, child } = open('linux');
    child.emit('exit', 3);
    expect(await result).toBe('failed');
  });

  it('reports failure when the system has no such command', async () => {
    const { result, child } = open('linux');
    child.emit('error', new Error('spawn xdg-open ENOENT'));
    expect(await result).toBe('failed');
  });

  it('reports failure when starting the command throws', async () => {
    const throwing = (() => {
      throw new Error('spawn failed');
    }) as unknown as typeof spawn;
    expect(await openBrowser(URL, { spawnFn: throwing, platform: 'linux' })).toBe('failed');
  });

  it('does not answer until the command finishes, however long that takes', async () => {
    const { result, child } = open('linux');
    const settled = vi.fn();
    void result.then(settled);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(settled).not.toHaveBeenCalled();

    // A slow failure, such as xdg-open giving up after waiting for a desktop that is not there.
    child.emit('exit', 4);
    expect(await result).toBe('failed');
  });

  it('keeps its first answer and handles events that arrive afterwards', async () => {
    const { result, child } = open('win32');
    child.emit('exit', 0);
    expect(await result).toBe('opened');

    // A late error must find a listener; an unhandled "error" event would crash the launcher.
    expect(child.listenerCount('error')).toBe(1);
    expect(() => child.emit('error', new Error('late failure'))).not.toThrow();
    expect(await result).toBe('opened');
  });
});
