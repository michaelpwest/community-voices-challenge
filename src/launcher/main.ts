import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { createInterface as createLineReader } from 'node:readline';
import { createInterface, type Interface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { ConfigError, loadConfig, loadEnvFile, type AppConfig } from '../config/config';
import { LOOPBACK_HOST, SHUTDOWN_MESSAGE } from '../shared/processProtocol';
import { ensureOllama } from './ollamaSetup';
import { openBrowser } from './openBrowser';
import { OwnedProcesses } from './ownedProcesses';
import { terminalPalette } from './palette';
import { selectOption, type MenuOption } from './selectMenu';

// Checks prerequisites, starts the API and the web UI, and opens the browser.
// Everything else (refreshing, generating, clearing data) is done in the web UI.

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MINIMUM_NODE: readonly [number, number] = [22, 13];
const CHILD_START_TIMEOUT_MS = 30_000;
const paint = terminalPalette;

type ChildName = 'api' | 'web';
const CHILD_ENTRY: Record<ChildName, string> = { api: 'src/api/main.ts', web: 'web/server.ts' };
// Runs TypeScript directly, and hides Node 22's notice that its built-in SQLite is still experimental.
const NODE_FLAGS = ['--disable-warning=ExperimentalWarning', '--import', 'tsx'];

const owned = new OwnedProcesses();
let activePrompt: Interface | undefined;
let shuttingDown = false;

function requestStop(): void {
  void shutdown(0);
}

/** Asks for a line of text during setup. While the prompt is open, Ctrl+C arrives as a readline event. */
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

/** Shows the choices offered during setup, such as what to do when Ollama is not running. */
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
  const child = spawn(process.execPath, [...NODE_FLAGS, CHILD_ENTRY[name]], {
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

async function startAndWait(name: ChildName, url: string, config: AppConfig): Promise<void> {
  startChild(name, config);
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

function watchForStopRequests(): void {
  // While a setup prompt is open, Ctrl+C is handled there instead of arriving as a signal.
  process.on('SIGINT', requestStop);
  process.on('SIGTERM', requestStop);
  process.on('SIGHUP', requestStop);
  // Lets a parent process (tests, automation) request the same clean stop.
  process.on('message', (message) => {
    if (message === SHUTDOWN_MESSAGE) requestStop();
  });
}

/**
 * Shows where the web UI is, and opens it in the browser when a person is at
 * the terminal and has not turned that off. Startup does not wait for the
 * browser: the address is printed straight away, and a warning follows only
 * if the system reports that it could not open one.
 */
function showWebUi(webUrl: string, config: AppConfig, interactive: boolean): void {
  if (!interactive || !config.openBrowser) {
    say(`Open ${paint.accent(webUrl)} in your browser.`);
    return;
  }
  say(`Web UI: ${paint.accent(webUrl)}`);
  say('Opening it in your browser. If nothing appears, go to that address yourself.');
  void openBrowser(webUrl).then((result) => {
    if (result === 'failed' && !shuttingDown) {
      say(paint.warn(`Could not open a browser automatically. Open ${webUrl} yourself.`));
    }
  });
}

async function main(): Promise<void> {
  assertSupportedNode();
  if (!loadEnvFile(REPO_ROOT)) say('No .env file found; using defaults. Copy .env.example to .env to customize.');
  let config = loadConfig(process.env, REPO_ROOT);

  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  watchForStopRequests();

  say(`${paint.bold(paint.accent('Community Voices'))}\n\nChecking Ollama...`);
  const setup = await ensureOllama(config.ollama, { interactive, paint, say, ask, choose }, owned);
  if (setup.action === 'quit') return shutdown(0);
  config = { ...config, ollama: { ...config.ollama, url: setup.ollamaUrl } };

  await assertPortFree(config.apiPort, 'API_PORT');
  await assertPortFree(config.webPort, 'WEB_PORT');
  say('\nStarting the API and web UI...');
  await startAndWait('api', `http://${LOOPBACK_HOST}:${config.apiPort}/api/health`, config);
  await startAndWait('web', `http://${LOOPBACK_HOST}:${config.webPort}/`, config);

  say('');
  showWebUi(`http://localhost:${config.webPort}`, config, interactive);
  say(paint.dim(`API: http://localhost:${config.apiPort}/api/health`));
  say('\nRunning. Press Ctrl+C to stop.');
}

main().catch(async (error: unknown) => {
  // Closing a setup prompt during shutdown can reject a pending question; that is not a failure.
  if (shuttingDown) return;
  sayProblem(error instanceof ConfigError || error instanceof Error ? error.message : String(error));
  await shutdown(1);
});
