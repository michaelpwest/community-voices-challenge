import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { createInterface as createLineReader } from 'node:readline';
import { createInterface, type Interface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { ConfigError, loadConfig, loadEnvFile, type AppConfig } from '../config/config';
import type { ApiErrorResponse, HealthResponse } from '../shared/health';
import { LOOPBACK_HOST, SHUTDOWN_MESSAGE } from '../shared/processProtocol';
import { clearDataWithConfirmation } from './clearData';
import { ensureOllama } from './ollamaSetup';
import { OwnedProcesses } from './ownedProcesses';
import { terminalPalette } from './palette';
import { selectOption, type MenuOption } from './selectMenu';
import { formatHealth } from './statusReport';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MINIMUM_NODE: readonly [number, number] = [22, 13];
const CHILD_START_TIMEOUT_MS = 30_000;
const paint = terminalPalette;
const MENU: MenuOption[] = [
  { key: 'r', label: 'Refresh feed' },
  { key: 's', label: 'System status' },
  { key: 'c', label: 'Clear data' },
  { key: 'q', label: 'Quit' },
];

type ChildName = 'api' | 'web';
const CHILD_ENTRY: Record<ChildName, string> = { api: 'src/api/main.ts', web: 'web/server.ts' };

const owned = new OwnedProcesses();
let activePrompt: Interface | undefined;
let shuttingDown = false;

function requestStop(): void {
  void shutdown(0);
}

/** Asks for a line of text. While the prompt is open, Ctrl+C arrives as a readline event. */
async function ask(question: string): Promise<string> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  activePrompt = prompt;
  prompt.on('SIGINT', requestStop);
  try {
    return await prompt.question(question);
  } finally {
    prompt.close();
    activePrompt = undefined;
  }
}

function choose(options: MenuOption[]): Promise<string> {
  return selectOption(options, { input: process.stdin, output: process.stdout, paint, onInterrupt: requestStop });
}

function say(line: string): void {
  console.log(line);
}

function sayProblem(line: string): void {
  console.error(paint.problem(line));
}

function assertSupportedNode(): void {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  const [minMajor, minMinor] = MINIMUM_NODE;
  if (major < minMajor || (major === minMajor && minor < minMinor)) {
    throw new Error(`Node.js ${minMajor}.${minMinor} or newer is required; this is ${process.versions.node}.`);
  }
}

function assertPortFree(port: number, envName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', (error: NodeJS.ErrnoException) => {
      const reason = error.code === 'EADDRINUSE' ? 'is already in use' : `cannot be used (${error.message})`;
      reject(new Error(`Port ${port} ${reason}. Stop the other process or change ${envName} in .env.`));
    });
    probe.listen(port, LOOPBACK_HOST, () => probe.close(() => resolve()));
  });
}

async function shutdown(exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  const names = owned.names();
  say(names.length > 0 ? `\nStopping ${names.join(', ')}...` : '\nNothing to stop.');
  await owned.stopAll();
  activePrompt?.close();
  say(paint.dim('Done. Only processes started by this launcher were stopped.'));
  process.exit(exitCode);
}

function onUnexpectedExit(name: string, detail: string): void {
  // On Ctrl+C the children can exit a moment before this process sees the signal.
  setTimeout(() => {
    if (shuttingDown) return;
    sayProblem(`\n${name} stopped unexpectedly (${detail}). Shutting down.`);
    void shutdown(1);
  }, 250);
}

function echoOutput(name: string, child: ChildProcess): void {
  for (const stream of [child.stdout, child.stderr]) {
    if (stream) createLineReader({ input: stream }).on('line', (line) => say(`${paint.dim(`[${name}]`)} ${line}`));
  }
}

function startChild(name: ChildName, config: AppConfig): void {
  const child = spawn(process.execPath, ['--import', 'tsx', CHILD_ENTRY[name]], {
    cwd: REPO_ROOT,
    // Values chosen in this session (such as a different Ollama URL) override .env in the child.
    env: {
      ...process.env,
      WEB_PORT: String(config.webPort),
      API_PORT: String(config.apiPort),
      OLLAMA_URL: config.ollama.url,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  echoOutput(name, child);
  owned.add(name, child, onUnexpectedExit);
}

async function waitUntilResponding(url: string, name: ChildName): Promise<void> {
  const deadline = Date.now() + CHILD_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!owned.names().includes(name)) throw new Error(`${name} exited during startup.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${name} did not respond at ${url} within ${CHILD_START_TIMEOUT_MS / 1000} seconds.`);
}

function apiUrl(config: AppConfig, path: string): string {
  return `http://${LOOPBACK_HOST}:${config.apiPort}${path}`;
}

async function startApi(config: AppConfig): Promise<void> {
  startChild('api', config);
  await waitUntilResponding(apiUrl(config, '/api/health'), 'api');
}

async function startWeb(config: AppConfig): Promise<void> {
  startChild('web', config);
  await waitUntilResponding(`http://${LOOPBACK_HOST}:${config.webPort}/`, 'web');
}

async function showStatus(config: AppConfig): Promise<void> {
  const response = await fetch(apiUrl(config, '/api/health'), { signal: AbortSignal.timeout(10_000) });
  const health = (await response.json()) as HealthResponse;
  formatHealth(health, paint).forEach(say);
  say(`Started by this launcher: ${owned.names().join(', ') || 'nothing'}`);
}

async function refreshFeed(config: AppConfig): Promise<void> {
  say('Requesting a feed refresh...');
  const response = await fetch(apiUrl(config, '/api/ingest'), { method: 'POST' });
  if (response.ok) {
    say(paint.ok('Feed refresh finished.'));
    return;
  }
  const body = (await response.json()) as Partial<ApiErrorResponse>;
  say(paint.warn(`Feed refresh failed (HTTP ${response.status}): ${body.error?.message ?? 'no details'}`));
}

async function clearData(config: AppConfig): Promise<void> {
  await clearDataWithConfirmation(
    { say, ask },
    {
      databasePath: config.databasePath,
      stopApi: () => owned.stop('api'),
      startApi: () => startApi(config),
    },
  );
}

async function runMenu(config: AppConfig): Promise<void> {
  for (;;) {
    say('');
    const choice = await choose(MENU);
    try {
      if (choice === 'r') await refreshFeed(config);
      else if (choice === 's') await showStatus(config);
      else if (choice === 'c') await clearData(config);
      else if (choice === 'q') return;
    } catch (error) {
      sayProblem(`Action failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function watchForStopRequests(): void {
  // While a menu or text prompt is open, Ctrl+C is handled there instead of arriving as a signal.
  process.on('SIGINT', requestStop);
  process.on('SIGTERM', requestStop);
  process.on('SIGHUP', requestStop);
  // Lets a parent process (tests, automation) request the same clean stop.
  process.on('message', (message) => {
    if (message === SHUTDOWN_MESSAGE) requestStop();
  });
}

async function main(): Promise<void> {
  assertSupportedNode();
  if (!loadEnvFile(REPO_ROOT)) say('No .env file found; using defaults. Copy .env.example to .env to customize.');
  let config = loadConfig(process.env, REPO_ROOT);

  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  watchForStopRequests();

  say(`${paint.bold(paint.accent('Community Voices launcher'))}\n\nChecking Ollama...`);
  const setup = await ensureOllama(config.ollama, { interactive, paint, say, ask, choose }, owned);
  if (setup.action === 'quit') return shutdown(0);
  config = { ...config, ollama: { ...config.ollama, url: setup.ollamaUrl } };

  await assertPortFree(config.apiPort, 'API_PORT');
  await assertPortFree(config.webPort, 'WEB_PORT');
  say('\nStarting the API and web UI...');
  await startApi(config);
  await startWeb(config);
  say(`\nWeb UI: ${paint.accent(`http://localhost:${config.webPort}`)}`);
  say(`API:    ${paint.accent(`http://localhost:${config.apiPort}/api/health`)}`);

  if (!interactive) {
    say('No interactive terminal: menu disabled. Press Ctrl+C to stop.');
    return;
  }
  await runMenu(config);
  await shutdown(0);
}

main().catch(async (error: unknown) => {
  // Closing the prompt during shutdown can reject a pending question; that is not a failure.
  if (shuttingDown) return;
  sayProblem(error instanceof ConfigError || error instanceof Error ? error.message : String(error));
  await shutdown(1);
});
