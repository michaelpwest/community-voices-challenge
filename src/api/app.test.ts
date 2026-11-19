import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config/config';
import type { DatabaseStatus, HealthResponse, OllamaStatus } from '../shared/health';
import { createApp } from './app';

const config = loadConfig({}, '/project');

const healthyDatabase: DatabaseStatus = { path: '/project/app.db', ok: true, vectorExtensionVersion: 'v0.1.9', error: null };

function ollamaStatus(overrides: Partial<OllamaStatus> = {}): OllamaStatus {
  return {
    url: config.ollama.url,
    reachable: true,
    version: '0.99.0',
    models: [
      { name: 'llama3.1:8b', role: 'generation', available: true },
      { name: 'nomic-embed-text', role: 'embedding', available: true },
    ],
    error: null,
    ...overrides,
  };
}

function appWith(ollama: OllamaStatus, database: DatabaseStatus = healthyDatabase) {
  return createApp({ config, checkOllama: async () => ollama, checkDatabase: () => database });
}

describe('GET /api/health', () => {
  it('reports ok when the database and Ollama are ready', async () => {
    const response = await appWith(ollamaStatus()).request('/api/health');
    expect(response.status).toBe(200);
    const body = (await response.json()) as HealthResponse;
    expect(body.status).toBe('ok');
    expect(body.source).toEqual({ instanceUrl: 'https://lemmy.world', community: 'games' });
    expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false);
  });

  it('reports degraded when Ollama is unreachable', async () => {
    const down = ollamaStatus({ reachable: false, version: null, error: 'connect ECONNREFUSED' });
    const body = (await (await appWith(down).request('/api/health')).json()) as HealthResponse;
    expect(body.status).toBe('degraded');
    expect(body.ollama.error).toBe('connect ECONNREFUSED');
  });

  it('reports degraded when a model is missing', async () => {
    const missing = ollamaStatus({
      models: [
        { name: 'llama3.1:8b', role: 'generation', available: false },
        { name: 'nomic-embed-text', role: 'embedding', available: true },
      ],
    });
    const body = (await (await appWith(missing).request('/api/health')).json()) as HealthResponse;
    expect(body.status).toBe('degraded');
  });

  it('reports degraded when the database fails', async () => {
    const broken: DatabaseStatus = { ...healthyDatabase, ok: false, vectorExtensionVersion: null, error: 'disk full' };
    const body = (await (await appWith(ollamaStatus(), broken).request('/api/health')).json()) as HealthResponse;
    expect(body.status).toBe('degraded');
  });
});

describe('other routes', () => {
  it('answers POST /api/ingest with a clear not-implemented error', async () => {
    const response = await appWith(ollamaStatus()).request('/api/ingest', { method: 'POST' });
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ error: { code: 'not_implemented' } });
  });

  it('answers unknown routes with a JSON 404', async () => {
    const response = await appWith(ollamaStatus()).request('/api/nope');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('answers unexpected failures with a JSON 500 that hides internals', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = createApp({
      config,
      checkOllama: async () => ollamaStatus(),
      checkDatabase: () => {
        throw new Error('secret detail');
      },
    });
    const response = await app.request('/api/health');
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('secret detail');
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
