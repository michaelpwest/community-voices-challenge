import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config/config';
import { EmbeddingError } from '../ollama/embeddings';
import type { DataStatus, IngestSummary, SearchResponse } from '../shared/discussions';
import type { DatabaseStatus, HealthResponse, OllamaStatus } from '../shared/health';
import { SourceError } from '../sources/discussionSource';
import { createApp, type AppDependencies } from './app';

const config = loadConfig({}, '/project');

const healthyDatabase: DatabaseStatus = { path: '/project/app.db', ok: true, vectorExtensionVersion: 'v0.1.9', error: null };
const emptyData: DataStatus = { posts: 0, comments: 0, embedded: 0, lastIngestion: null };

const summary: IngestSummary = {
  source: 'lemmy:lemmy.world',
  community: 'games',
  windowStart: '2026-01-08T12:00:00.000Z',
  windowEnd: '2026-01-15T12:00:00.000Z',
  startedAt: '2026-01-15T12:00:00.000Z',
  finishedAt: '2026-01-15T12:00:40.000Z',
  fetchedPosts: 3,
  fetchedComments: 3,
  inserted: 6,
  updated: 0,
  unchanged: 0,
  embedded: 6,
  pendingEmbeddings: 0,
  embeddingError: null,
};

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

async function emptySearch(query: string): Promise<SearchResponse> {
  return {
    query,
    windowStart: summary.windowStart,
    windowEnd: summary.windowEnd,
    embeddingModel: 'nomic-embed-text',
    results: [],
  };
}

function appWith(overrides: Partial<AppDependencies> = {}) {
  return createApp({
    config,
    checkOllama: async () => ollamaStatus(),
    checkDatabase: () => healthyDatabase,
    getDataStatus: () => emptyData,
    ingest: async () => summary,
    search: emptySearch,
    ...overrides,
  });
}

async function health(overrides: Partial<AppDependencies> = {}): Promise<HealthResponse> {
  const response = await appWith(overrides).request('/api/health');
  expect(response.status).toBe(200);
  return (await response.json()) as HealthResponse;
}

describe('GET /api/health', () => {
  it('reports ok when the database and Ollama are ready', async () => {
    const body = await health();
    expect(body.status).toBe('ok');
    // Only the public source fields are exposed, not the whole source configuration.
    expect(body.source).toEqual({ instanceUrl: 'https://lemmy.world', community: 'games' });
    expect(body.data).toEqual(emptyData);
    expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false);
  });

  it('reports degraded when Ollama is unreachable', async () => {
    const down = ollamaStatus({ reachable: false, version: null, error: 'connect ECONNREFUSED' });
    const body = await health({ checkOllama: async () => down });
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
    expect((await health({ checkOllama: async () => missing })).status).toBe('degraded');
  });

  it('reports degraded when the database fails', async () => {
    const broken: DatabaseStatus = { ...healthyDatabase, ok: false, vectorExtensionVersion: null, error: 'disk full' };
    expect((await health({ checkDatabase: () => broken })).status).toBe('degraded');
  });

  it('still answers when the stored data cannot be read', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const body = await health({
      getDataStatus: () => {
        throw new Error('database is locked');
      },
    });
    expect(body.data).toBeNull();
    logged.mockRestore();
  });
});

describe('POST /api/ingest', () => {
  it('returns the ingestion summary', async () => {
    const response = await appWith().request('/api/ingest', { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(summary);
  });

  it('answers 502 with the reason when the community source cannot be read', async () => {
    const ingest = async (): Promise<IngestSummary> => {
      throw new SourceError('Could not read /api/v3/post/list from lemmy.world after 3 attempts: network error');
    };
    const response = await appWith({ ingest }).request('/api/ingest', { method: 'POST' });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: {
        code: 'source_unavailable',
        message: 'Could not read /api/v3/post/list from lemmy.world after 3 attempts: network error',
      },
    });
  });

  it('refuses a second refresh while one is running', async () => {
    let finish: (value: IngestSummary) => void = () => undefined;
    const ingest = vi.fn(() => new Promise<IngestSummary>((resolve) => (finish = resolve)));
    const app = appWith({ ingest });

    const first = app.request('/api/ingest', { method: 'POST' });
    const second = await app.request('/api/ingest', { method: 'POST' });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: { code: 'ingest_in_progress' } });

    finish(summary);
    expect((await first).status).toBe(200);
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it('allows a new refresh after a failed one', async () => {
    const ingest = vi
      .fn<() => Promise<IngestSummary>>()
      .mockRejectedValueOnce(new SourceError('offline'))
      .mockResolvedValueOnce(summary);
    const app = appWith({ ingest });
    expect((await app.request('/api/ingest', { method: 'POST' })).status).toBe(502);
    expect((await app.request('/api/ingest', { method: 'POST' })).status).toBe(200);
  });
});

describe('GET /api/search', () => {
  it('passes the query and a default result count to retrieval', async () => {
    const search = vi.fn(emptySearch);
    const response = await appWith({ search }).request('/api/search?q=%20co-op%20games%20');
    expect(response.status).toBe(200);
    expect(search).toHaveBeenCalledWith('co-op games', 5);
    expect(await response.json()).toMatchObject({ query: 'co-op games', results: [] });
  });

  it('accepts an explicit result count', async () => {
    const search = vi.fn(emptySearch);
    await appWith({ search }).request('/api/search?q=delay&k=12');
    expect(search).toHaveBeenCalledWith('delay', 12);
  });

  it.each([
    ['a missing query', '/api/search'],
    ['a blank query', '/api/search?q=%20%20'],
    ['a result count of zero', '/api/search?q=delay&k=0'],
    ['a result count above the limit', '/api/search?q=delay&k=21'],
    ['a result count that is not a number', '/api/search?q=delay&k=many'],
    ['a query that is too long', `/api/search?q=${'x'.repeat(501)}`],
  ])('rejects %s', async (_label, path) => {
    const search = vi.fn();
    const response = await appWith({ search }).request(path);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } });
    expect(search).not.toHaveBeenCalled();
  });

  it('answers 503 with the reason when Ollama cannot embed the query', async () => {
    const search = async (): Promise<SearchResponse> => {
      throw new EmbeddingError('Ollama is not reachable at http://localhost:11434.');
    };
    const response = await appWith({ search }).request('/api/search?q=delay');
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'ollama_unavailable' } });
  });
});

describe('other routes', () => {
  it('answers unknown routes with a JSON 404', async () => {
    const response = await appWith().request('/api/nope');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('answers unexpected failures with a JSON 500 that hides internals', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = appWith({
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
