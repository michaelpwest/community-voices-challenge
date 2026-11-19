import { z } from 'zod';
import type { ModelStatus, OllamaStatus } from '../shared/health';

export interface OllamaSettings {
  url: string;
  model: string;
  embedModel: string;
}

export type FetchFn = typeof fetch;

const tagsSchema = z.object({ models: z.array(z.object({ name: z.string() })) });
const versionSchema = z.object({ version: z.string() });

/** Ollama lists models with an explicit tag; an untagged name means `:latest`. */
export function normalizeModelName(name: string): string {
  return name.includes(':') ? name : `${name}:latest`;
}

async function fetchJson(url: string, fetchFn: FetchFn, timeoutMs: number): Promise<unknown> {
  const response = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${url} responded with HTTP ${response.status}`);
  return response.json();
}

function describeError(error: unknown): string {
  if (error instanceof z.ZodError) return 'unexpected response shape (is this an Ollama server?)';
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return 'request timed out';
    const cause = error.cause instanceof Error ? `: ${error.cause.message}` : '';
    return `${error.message}${cause}`;
  }
  return String(error);
}

/** Reports whether Ollama is reachable and whether the configured models are pulled. Never throws. */
export async function checkOllama(
  settings: OllamaSettings,
  fetchFn: FetchFn = fetch,
  timeoutMs = 3000,
): Promise<OllamaStatus> {
  const required: Array<Pick<ModelStatus, 'name' | 'role'>> = [
    { name: settings.model, role: 'generation' },
    { name: settings.embedModel, role: 'embedding' },
  ];
  try {
    const [tags, version] = await Promise.all([
      fetchJson(`${settings.url}/api/tags`, fetchFn, timeoutMs).then((body) => tagsSchema.parse(body)),
      fetchJson(`${settings.url}/api/version`, fetchFn, timeoutMs).then((body) => versionSchema.parse(body)),
    ]);
    const installed = new Set(tags.models.map((model) => normalizeModelName(model.name)));
    return {
      url: settings.url,
      reachable: true,
      version: version.version,
      models: required.map((model) => ({ ...model, available: installed.has(normalizeModelName(model.name)) })),
      error: null,
    };
  } catch (error) {
    return {
      url: settings.url,
      reachable: false,
      version: null,
      models: required.map((model) => ({ ...model, available: false })),
      error: describeError(error),
    };
  }
}

export function missingModels(status: OllamaStatus): string[] {
  return status.models.filter((model) => !model.available).map((model) => model.name);
}

export function isOllamaReady(status: OllamaStatus): boolean {
  return status.reachable && missingModels(status).length === 0;
}
