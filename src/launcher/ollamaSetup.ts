import type { ChildProcess } from 'node:child_process';
import { checkOllama, isOllamaReady, missingModels, type OllamaSettings } from '../ollama/ollamaStatus';
import type { OllamaStatus } from '../shared/health';
import { findOllamaCli, isLocalUrl, startModelPull, startOllamaServer } from './ollamaCli';
import type { OwnedProcesses } from './ownedProcesses';
import type { Palette } from './palette';
import type { MenuOption } from './selectMenu';
import { formatOllama } from './statusReport';

export interface SetupIo {
  interactive: boolean;
  paint: Palette;
  say(line: string): void;
  /** Asks for a line of text. */
  ask(question: string): Promise<string>;
  /** Shows a menu and resolves with the chosen option's key. */
  choose(options: MenuOption[]): Promise<string>;
}

export interface SetupDependencies {
  check: (settings: OllamaSettings) => Promise<OllamaStatus>;
  findCli: () => string | null;
  startServer: (cli: string, url: string) => ChildProcess;
  startPull: (cli: string, url: string, model: string) => ChildProcess;
  pollMs: number;
}

export type SetupOutcome = { action: 'continue'; ollamaUrl: string; ready: boolean } | { action: 'quit' };

const defaultDependencies: SetupDependencies = {
  check: (settings) => checkOllama(settings),
  findCli: findOllamaCli,
  startServer: startOllamaServer,
  startPull: startModelPull,
  pollMs: 500,
};

const SERVER_START_ATTEMPTS = 30;

function isHttpUrl(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    child.once('exit', (code) => resolve(code));
    child.once('error', () => resolve(null));
  });
}

/**
 * Checks Ollama and, when it is not ready, explains what is missing and lets
 * the user choose what to do. Nothing is installed, started, or downloaded
 * without the user choosing it; without an interactive terminal it only reports.
 */
export async function ensureOllama(
  initial: OllamaSettings,
  io: SetupIo,
  owned: OwnedProcesses,
  dependencies: Partial<SetupDependencies> = {},
): Promise<SetupOutcome> {
  const deps = { ...defaultDependencies, ...dependencies };
  let settings = initial;

  for (;;) {
    const status = await deps.check(settings);
    formatOllama(status, io.paint).forEach((line) => io.say(line));
    if (isOllamaReady(status)) return { action: 'continue', ollamaUrl: settings.url, ready: true };

    const cli = deps.findCli();
    const options = status.reachable
      ? describeMissingModels(status, cli, io)
      : describeUnreachable(settings.url, cli, io);

    if (!io.interactive) {
      io.say('No interactive terminal, so continuing without a ready Ollama. Reports will fail until this is fixed.');
      return { action: 'continue', ollamaUrl: settings.url, ready: false };
    }

    const choice = await io.choose(options);
    if (choice === 'q') return { action: 'quit' };
    if (choice === 'c') return { action: 'continue', ollamaUrl: settings.url, ready: false };
    if (choice === 'u' && !status.reachable) {
      settings = { ...settings, url: await askForUrl(settings.url, io) };
    } else if (choice === 's' && !status.reachable && cli && isLocalUrl(settings.url)) {
      await startOwnedServer(cli, settings, io, owned, deps);
    } else if (choice === 'p' && status.reachable && cli) {
      await pullMissingModels(cli, settings.url, status, io, owned, deps);
    }
    // Anything else (including "r") re-checks.
  }
}

function describeUnreachable(url: string, cli: string | null, io: SetupIo): MenuOption[] {
  const options: MenuOption[] = [];
  if (cli && isLocalUrl(url)) {
    io.say('Ollama is installed but not running.');
    options.push({ key: 's', label: 'Start Ollama now' });
  } else if (!cli) {
    io.say('The Ollama CLI was not found. This launcher does not install software for you.');
    io.say('Install Ollama from https://ollama.com/download, start it, then retry.');
  }
  io.say('If Ollama runs elsewhere, enter its URL here or set OLLAMA_URL in .env.');
  options.push(
    { key: 'u', label: 'Use a different URL' },
    { key: 'r', label: 'Retry' },
    { key: 'c', label: 'Continue without Ollama' },
    { key: 'q', label: 'Quit' },
  );
  return options;
}

function describeMissingModels(status: OllamaStatus, cli: string | null, io: SetupIo): MenuOption[] {
  io.say(`Ollama is running, but ${missingModels(status).length} required model(s) have not been downloaded.`);
  const options: MenuOption[] = [];
  if (cli) options.push({ key: 'p', label: 'Pull now (downloads may be several GB)' });
  options.push(
    { key: 'r', label: 'Re-check' },
    { key: 'c', label: 'Continue without the models' },
    { key: 'q', label: 'Quit' },
  );
  return options;
}

async function askForUrl(currentUrl: string, io: SetupIo): Promise<string> {
  const answer = (await io.ask('Ollama URL (for this session only): ')).trim().replace(/\/+$/, '');
  if (isHttpUrl(answer)) return answer;
  io.say(`"${answer}" is not an http:// or https:// URL; keeping ${currentUrl}.`);
  return currentUrl;
}

async function startOwnedServer(
  cli: string,
  settings: OllamaSettings,
  io: SetupIo,
  owned: OwnedProcesses,
  deps: SetupDependencies,
): Promise<void> {
  io.say('Starting "ollama serve". It will be stopped when this launcher exits.');
  owned.add('ollama', deps.startServer(cli, settings.url));
  for (let attempt = 0; attempt < SERVER_START_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, deps.pollMs));
    if ((await deps.check(settings)).reachable) return;
    if (!owned.names().includes('ollama')) break;
  }
  io.say('Ollama did not become reachable.');
  await owned.stop('ollama');
}

async function pullMissingModels(
  cli: string,
  url: string,
  status: OllamaStatus,
  io: SetupIo,
  owned: OwnedProcesses,
  deps: SetupDependencies,
): Promise<void> {
  for (const model of missingModels(status)) {
    io.say(`Running: ollama pull ${model}`);
    const child = deps.startPull(cli, url, model);
    owned.add(`ollama pull ${model}`, child);
    const exitCode = await waitForExit(child);
    if (exitCode !== 0) {
      io.say(`"ollama pull ${model}" did not finish successfully.`);
      return;
    }
  }
}
