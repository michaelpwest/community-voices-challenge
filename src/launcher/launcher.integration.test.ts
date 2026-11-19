import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HealthResponse } from '../shared/health';
import { SHUTDOWN_MESSAGE } from '../shared/processProtocol';

// Starts the real launcher (without a terminal) against a stand-in Ollama
// server, then checks startup, the web-to-API proxy, and a clean shutdown.

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

async function findFreePort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Answers the two Ollama endpoints the status check uses. */
function createStandInOllama(): Server {
  return createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/tags') {
      response.end(JSON.stringify({ models: [{ name: 'llama3.1:8b' }, { name: 'nomic-embed-text:latest' }] }));
    } else if (request.url === '/api/version') {
      response.end(JSON.stringify({ version: '0.0.0-test' }));
    } else {
      response.statusCode = 404;
      response.end('{}');
    }
  });
}

function waitForOutput(child: ChildProcess, text: string, output: { value: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = (): void => {
      if (output.value.includes(text)) resolve();
    };
    child.stdout?.on('data', check);
    child.once('exit', (code) => reject(new Error(`launcher exited early (code ${code}):\n${output.value}`)));
    check();
  });
}

async function isListening(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

describe('launcher', () => {
  let workDir: string;
  let standInOllama: Server;
  let launcher: ChildProcess | undefined;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'community-voices-launcher-'));
    standInOllama = createStandInOllama();
  });

  afterEach(async () => {
    if (launcher && launcher.exitCode === null) launcher.kill();
    await new Promise((resolve) => standInOllama.close(resolve));
    rmSync(workDir, { recursive: true, force: true });
  });

  it('starts the API and web UI, then stops only what it started', async () => {
    const ollamaPort = await listen(standInOllama);
    const apiPort = await findFreePort();
    const webPort = await findFreePort();

    const output = { value: '' };
    launcher = spawn(process.execPath, ['--import', 'tsx', 'src/launcher/main.ts'], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        API_PORT: String(apiPort),
        WEB_PORT: String(webPort),
        OLLAMA_URL: `http://127.0.0.1:${ollamaPort}`,
        OLLAMA_MODEL: 'llama3.1:8b',
        OLLAMA_EMBED_MODEL: 'nomic-embed-text',
        DATABASE_PATH: join(workDir, 'test.db'),
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    launcher.stdout?.on('data', (chunk: Buffer) => (output.value += chunk.toString()));
    launcher.stderr?.on('data', (chunk: Buffer) => (output.value += chunk.toString()));

    await waitForOutput(launcher, 'menu disabled', output);

    // The browser path: web origin -> Vite proxy -> API -> database and Ollama checks.
    const healthResponse = await fetch(`http://127.0.0.1:${webPort}/api/health`);
    const health = (await healthResponse.json()) as HealthResponse;
    expect(health.status).toBe('ok');
    expect(health.database.ok).toBe(true);
    expect(health.ollama).toMatchObject({ reachable: true, version: '0.0.0-test' });

    const page = await fetch(`http://127.0.0.1:${webPort}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<div id="root">');

    const exited = new Promise<number | null>((resolve) => launcher?.once('exit', resolve));
    launcher.send(SHUTDOWN_MESSAGE);
    expect(await exited, output.value).toBe(0);

    expect(await isListening(apiPort)).toBe(false);
    expect(await isListening(webPort)).toBe(false);
    // The Ollama server was running before the launcher and must still be running.
    expect(await isListening(ollamaPort)).toBe(true);
  }, 90_000);
});
