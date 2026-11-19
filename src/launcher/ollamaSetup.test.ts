import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import type { OllamaSettings } from '../ollama/ollamaStatus';
import type { OllamaStatus } from '../shared/health';
import { ensureOllama, type SetupDependencies, type SetupIo } from './ollamaSetup';
import { OwnedProcesses } from './ownedProcesses';
import { plainPalette } from './palette';
import { FakeChild } from './testSupport';

const SETTINGS: OllamaSettings = { url: 'http://localhost:11434', model: 'llama3.1:8b', embedModel: 'nomic-embed-text' };

function status(url: string, reachable: boolean, missing: string[] = []): OllamaStatus {
  return {
    url,
    reachable,
    version: reachable ? '0.99.0' : null,
    models: [
      { name: SETTINGS.model, role: 'generation', available: reachable && !missing.includes(SETTINGS.model) },
      { name: SETTINGS.embedModel, role: 'embedding', available: reachable && !missing.includes(SETTINGS.embedModel) },
    ],
    error: reachable ? null : 'connect ECONNREFUSED',
  };
}

function scriptedIo(answers: string[], interactive = true) {
  const said: string[] = [];
  const io: SetupIo = {
    interactive,
    paint: plainPalette,
    say: (line) => void said.push(line),
    ask: vi.fn(async () => answers.shift() ?? ''),
    choose: vi.fn(async () => answers.shift() ?? 'q'),
  };
  return { io, said };
}

function dependencies(overrides: Partial<SetupDependencies>): SetupDependencies {
  return {
    check: async (settings) => status(settings.url, true),
    findCli: () => 'ollama',
    startServer: vi.fn(() => new FakeChild(false, true) as unknown as ChildProcess),
    startPull: vi.fn(() => new FakeChild(false, true) as unknown as ChildProcess),
    pollMs: 1,
    ...overrides,
  };
}

function ownedRegistry(): OwnedProcesses {
  return new OwnedProcesses({ forceKill: (child) => (child as FakeChild).exit(1), graceMs: 20 });
}

describe('ensureOllama', () => {
  it('continues without asking anything when Ollama is ready', async () => {
    const { io } = scriptedIo([]);
    const outcome = await ensureOllama(SETTINGS, io, ownedRegistry(), dependencies({}));
    expect(outcome).toEqual({ action: 'continue', ollamaUrl: SETTINGS.url, ready: true });
    expect(io.ask).not.toHaveBeenCalled();
    expect(io.choose).not.toHaveBeenCalled();
  });

  it('never starts or downloads anything without an interactive terminal', async () => {
    const { io, said } = scriptedIo([], false);
    const deps = dependencies({ check: async (settings) => status(settings.url, false) });
    const outcome = await ensureOllama(SETTINGS, io, ownedRegistry(), deps);
    expect(outcome).toEqual({ action: 'continue', ollamaUrl: SETTINGS.url, ready: false });
    expect(deps.startServer).not.toHaveBeenCalled();
    expect(deps.startPull).not.toHaveBeenCalled();
    expect(said.join('\n')).toContain('NOT REACHABLE');
  });

  it('points to the download page instead of installing when the CLI is missing', async () => {
    const { io, said } = scriptedIo(['q']);
    const deps = dependencies({ check: async (settings) => status(settings.url, false), findCli: () => null });
    const outcome = await ensureOllama(SETTINGS, io, ownedRegistry(), deps);
    expect(outcome).toEqual({ action: 'quit' });
    expect(said.join('\n')).toContain('https://ollama.com/download');
    expect(deps.startServer).not.toHaveBeenCalled();
  });

  it('switches to a URL the user enters and re-checks it', async () => {
    const { io } = scriptedIo(['u', 'http://gpu-box:11434/']);
    const deps = dependencies({ check: async (settings) => status(settings.url, settings.url.includes('gpu-box')) });
    const outcome = await ensureOllama(SETTINGS, io, ownedRegistry(), deps);
    expect(outcome).toEqual({ action: 'continue', ollamaUrl: 'http://gpu-box:11434', ready: true });
  });

  it('keeps the current URL when the entered one is invalid', async () => {
    const { io, said } = scriptedIo(['u', 'not a url', 'c']);
    const deps = dependencies({ check: async (settings) => status(settings.url, false) });
    const outcome = await ensureOllama(SETTINGS, io, ownedRegistry(), deps);
    expect(outcome).toEqual({ action: 'continue', ollamaUrl: SETTINGS.url, ready: false });
    expect(said.join('\n')).toContain('is not an http:// or https:// URL');
  });

  it('starts Ollama only when the user chooses to, and registers it as owned', async () => {
    const { io } = scriptedIo(['s']);
    const owned = ownedRegistry();
    let started = false;
    const deps = dependencies({
      check: async (settings) => status(settings.url, started),
      startServer: vi.fn(() => {
        started = true;
        return new FakeChild(false, true) as unknown as ChildProcess;
      }),
    });
    const outcome = await ensureOllama(SETTINGS, io, owned, deps);
    expect(outcome).toMatchObject({ action: 'continue', ready: true });
    expect(deps.startServer).toHaveBeenCalledTimes(1);
    expect(owned.names()).toEqual(['ollama']);
  });

  it('does not offer to start Ollama for a remote URL', async () => {
    const remote = { ...SETTINGS, url: 'http://gpu-box:11434' };
    const { io } = scriptedIo(['s', 'q']);
    const deps = dependencies({ check: async (settings) => status(settings.url, false) });
    await ensureOllama(remote, io, ownedRegistry(), deps);
    expect(deps.startServer).not.toHaveBeenCalled();
  });

  it('pulls missing models only after the user chooses to', async () => {
    const { io } = scriptedIo(['p']);
    let pulled = false;
    const deps = dependencies({
      check: async (settings) => status(settings.url, true, pulled ? [] : [SETTINGS.embedModel]),
      startPull: vi.fn(() => {
        pulled = true;
        const child = new FakeChild(false, true);
        queueMicrotask(() => child.exit(0));
        return child as unknown as ChildProcess;
      }),
    });
    const outcome = await ensureOllama(SETTINGS, io, ownedRegistry(), deps);
    expect(outcome).toMatchObject({ action: 'continue', ready: true });
    expect(deps.startPull).toHaveBeenCalledWith('ollama', SETTINGS.url, SETTINGS.embedModel);
  });

  it('lets the user continue without the missing models', async () => {
    const { io } = scriptedIo(['c']);
    const deps = dependencies({ check: async (settings) => status(settings.url, true, [SETTINGS.model]) });
    const outcome = await ensureOllama(SETTINGS, io, ownedRegistry(), deps);
    expect(outcome).toEqual({ action: 'continue', ollamaUrl: SETTINGS.url, ready: false });
    expect(deps.startPull).not.toHaveBeenCalled();
  });
});
