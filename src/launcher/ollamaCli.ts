import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

/** Returns a runnable `ollama` command, or null when the CLI is not installed. */
export function findOllamaCli(): string | null {
  const candidates = ['ollama'];
  // The Windows installer's default location, in case PATH has not been refreshed yet.
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    candidates.push(join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe'));
  }
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['--version'], { stdio: 'ignore', timeout: 5000, windowsHide: true });
    if (!result.error) return candidate;
  }
  return null;
}

export function isLocalUrl(url: string): boolean {
  const { hostname } = new URL(url);
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
}

function ollamaEnv(url: string): NodeJS.ProcessEnv {
  return { ...process.env, OLLAMA_HOST: new URL(url).origin };
}

/** Starts `ollama serve` bound to the configured URL. The caller owns the returned process. */
export function startOllamaServer(cli: string, url: string): ChildProcess {
  return spawn(cli, ['serve'], { env: ollamaEnv(url), stdio: 'ignore', windowsHide: true });
}

/** Runs `ollama pull`, showing its progress in this terminal. The caller owns the returned process. */
export function startModelPull(cli: string, url: string, model: string): ChildProcess {
  return spawn(cli, ['pull', model], { env: ollamaEnv(url), stdio: 'inherit' });
}
