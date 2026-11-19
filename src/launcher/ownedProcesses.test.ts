import { describe, expect, it, vi } from 'vitest';
import { SHUTDOWN_MESSAGE } from '../shared/processProtocol';
import { OwnedProcesses, type ManagedChild } from './ownedProcesses';
import { FakeChild } from './testSupport';

function registry(platform: NodeJS.Platform = 'linux') {
  const forceKill = vi.fn((child: ManagedChild) => (child as FakeChild).exit(1));
  return { owned: new OwnedProcesses({ forceKill, graceMs: 20, platform }), forceKill };
}

describe('OwnedProcesses', () => {
  it('asks a connected child to shut down and does not force-kill it when it complies', async () => {
    const { owned, forceKill } = registry();
    const child = new FakeChild(true, true);
    owned.add('api', child);
    await owned.stop('api');
    expect(child.sent).toEqual([SHUTDOWN_MESSAGE]);
    expect(forceKill).not.toHaveBeenCalled();
    expect(owned.names()).toEqual([]);
  });

  it('force-kills a child that ignores the shutdown request', async () => {
    const { owned, forceKill } = registry();
    const child = new FakeChild(true, false);
    owned.add('web', child);
    await owned.stop('web');
    expect(forceKill).toHaveBeenCalledWith(child);
    expect(owned.names()).toEqual([]);
  });

  it('sends SIGTERM to a child without an IPC channel on POSIX', async () => {
    const { owned, forceKill } = registry('linux');
    const child = new FakeChild(false, true);
    owned.add('ollama', child);
    await owned.stop('ollama');
    expect(child.signals).toEqual(['SIGTERM']);
    expect(forceKill).not.toHaveBeenCalled();
  });

  it('force-kills a child without an IPC channel on Windows, which has no SIGTERM', async () => {
    const { owned, forceKill } = registry('win32');
    const child = new FakeChild(false, true);
    owned.add('ollama', child);
    await owned.stop('ollama');
    expect(child.signals).toEqual([]);
    expect(forceKill).toHaveBeenCalledWith(child);
  });

  it('stopAll stops every registered child and nothing else', async () => {
    const { owned } = registry();
    const api = new FakeChild(true, true);
    const web = new FakeChild(true, true);
    const preExisting = new FakeChild(true, true);
    owned.add('api', api);
    owned.add('web', web);
    await owned.stopAll();
    expect(api.exitCode).toBe(0);
    expect(web.exitCode).toBe(0);
    expect(preExisting.sent).toEqual([]);
    expect(preExisting.signals).toEqual([]);
    expect(preExisting.exitCode).toBeNull();
  });

  it('reports an exit nobody asked for, and forgets the child', () => {
    const { owned } = registry();
    const onUnexpectedExit = vi.fn();
    const child = new FakeChild(true, true);
    owned.add('api', child, onUnexpectedExit);
    child.exit(3);
    expect(onUnexpectedExit).toHaveBeenCalledWith('api', 'exit code 3');
    expect(owned.names()).toEqual([]);
  });

  it('does not report an exit that it requested', async () => {
    const { owned } = registry();
    const onUnexpectedExit = vi.fn();
    owned.add('api', new FakeChild(true, true), onUnexpectedExit);
    await owned.stop('api');
    expect(onUnexpectedExit).not.toHaveBeenCalled();
  });

  it('ignores a stop request for an unknown name', async () => {
    const { owned, forceKill } = registry();
    await expect(owned.stop('missing')).resolves.toBeUndefined();
    expect(forceKill).not.toHaveBeenCalled();
  });
});
