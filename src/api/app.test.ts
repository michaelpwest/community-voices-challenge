import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config/config';
import { GenerationError } from '../ollama/chat';
import { EmbeddingError } from '../ollama/embeddings';
import { NoDataError } from '../reports/reportService';
import type { DataStatus, IngestSummary, SearchResponse } from '../shared/discussions';
import type { DatabaseStatus, HealthResponse, OllamaStatus } from '../shared/health';
import type { EmbeddingMap, RetrievalStats } from '../shared/insights';
import type { ReportJobStatus, ReportRun } from '../shared/reports';
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

// Only the fields the routes pass through matter here; report content is tested in src/reports.
const reportRun = { id: 7, community: 'games' } as ReportRun;

const embeddingMap: EmbeddingMap = {
  embeddingModel: 'nomic-embed-text',
  method: 'pca',
  windowStart: summary.windowStart,
  windowEnd: summary.windowEnd,
  explainedVariance: [0.4, 0.2],
  points: [],
};
const retrievalStats: RetrievalStats = { totalRetrievals: 0, discussionsRetrieved: 0, top: [] };

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
    generateReports: async () => reportRun,
    getLatestReport: () => null,
    getEmbeddingMap: () => embeddingMap,
    getRetrievalStats: () => retrievalStats,
    clearData: () => ({ discussions: 6, reports: 1 }),
    ...overrides,
  });
}

/** Waits for work started by a request to finish (the report job runs in the background). */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function reportStatus(app: ReturnType<typeof appWith>): Promise<ReportJobStatus> {
  return (await (await app.request('/api/reports/status')).json()) as ReportJobStatus;
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

describe('report routes', () => {
  it('starts idle', async () => {
    expect(await reportStatus(appWith())).toEqual({
      state: 'idle',
      step: null,
      startedAt: null,
      finishedAt: null,
      error: null,
    });
  });

  it('starts generation in the background and reports progress, then success', async () => {
    let finish: (run: ReportRun) => void = () => undefined;
    let reportStep: (step: string) => void = () => undefined;
    const generateReports = vi.fn((onStep: (step: string) => void) => {
      reportStep = onStep;
      return new Promise<ReportRun>((resolve) => (finish = resolve));
    });
    const app = appWith({ generateReports });

    const started = await app.request('/api/reports/generate', { method: 'POST' });
    expect(started.status).toBe(202);
    expect(await started.json()).toMatchObject({ state: 'running', error: null });

    reportStep('Generating the baseline report');
    expect(await reportStatus(app)).toMatchObject({ state: 'running', step: 'Generating the baseline report' });

    finish(reportRun);
    await settle();
    const done = await reportStatus(app);
    expect(done).toMatchObject({ state: 'succeeded', step: null, error: null });
    expect(done.finishedAt).not.toBeNull();
  });

  it('refuses to start a second generation while one is running', async () => {
    const generateReports = vi.fn(() => new Promise<ReportRun>(() => undefined));
    const app = appWith({ generateReports });
    await app.request('/api/reports/generate', { method: 'POST' });
    const second = await app.request('/api/reports/generate', { method: 'POST' });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: { code: 'report_in_progress' } });
    expect(generateReports).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['there is no data', new NoDataError(), 'Refresh the feed first'],
    ['Ollama is unreachable', new GenerationError('Ollama is not reachable at http://localhost:11434.'), 'not reachable'],
    ['embedding fails', new EmbeddingError('Ollama does not have the embedding model "x".'), 'embedding model'],
  ])('reports the reason when %s', async (_label, error, expected) => {
    const app = appWith({
      generateReports: async () => {
        throw error;
      },
    });
    await app.request('/api/reports/generate', { method: 'POST' });
    await settle();
    const status = await reportStatus(app);
    expect(status.state).toBe('failed');
    expect(status.error).toContain(expected);
  });

  it('hides the details of an unexpected failure and allows another attempt', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const generateReports = vi
      .fn<() => Promise<ReportRun>>()
      .mockRejectedValueOnce(new Error('secret detail'))
      .mockResolvedValueOnce(reportRun);
    const app = appWith({ generateReports });

    await app.request('/api/reports/generate', { method: 'POST' });
    await settle();
    const failed = await reportStatus(app);
    expect(failed.state).toBe('failed');
    expect(failed.error).not.toContain('secret detail');

    expect((await app.request('/api/reports/generate', { method: 'POST' })).status).toBe(202);
    await settle();
    expect((await reportStatus(app)).state).toBe('succeeded');
    logged.mockRestore();
  });

  it('returns the latest stored report run', async () => {
    const response = await appWith({ getLatestReport: () => reportRun }).request('/api/reports/latest');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 7, community: 'games' });
  });

  it('answers 404 before any report exists', async () => {
    const response = await appWith().request('/api/reports/latest');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'no_report' } });
  });
});

describe('POST /api/data/clear', () => {
  const clear = (app: ReturnType<typeof appWith>, body: unknown) =>
    app.request('/api/data/clear', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  it('deletes the stored data when the confirmation word is sent', async () => {
    const clearData = vi.fn(() => ({ discussions: 6, reports: 1 }));
    const response = await clear(appWith({ clearData }), { confirm: 'DELETE' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ discussions: 6, reports: 1 });
    expect(clearData).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no body', ''],
    ['an empty object', {}],
    ['the wrong word', { confirm: 'yes' }],
    ['the right word in the wrong case', { confirm: 'delete' }],
    ['a true flag instead of the word', { confirm: true }],
    ['text that is not JSON', 'DELETE'],
  ])('deletes nothing when sent %s', async (_label, body) => {
    const clearData = vi.fn(() => ({ discussions: 0, reports: 0 }));
    const response = await clear(appWith({ clearData }), body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'confirmation_required' } });
    expect(clearData).not.toHaveBeenCalled();
  });

  it('refuses while a feed refresh is running', async () => {
    const clearData = vi.fn(() => ({ discussions: 0, reports: 0 }));
    const app = appWith({ clearData, ingest: () => new Promise<IngestSummary>(() => undefined) });
    void app.request('/api/ingest', { method: 'POST' });
    const response = await clear(app, { confirm: 'DELETE' });
    expect(response.status).toBe(409);
    expect(clearData).not.toHaveBeenCalled();
  });

  it('refuses while reports are being generated', async () => {
    const clearData = vi.fn(() => ({ discussions: 0, reports: 0 }));
    const app = appWith({ clearData, generateReports: () => new Promise<ReportRun>(() => undefined) });
    await app.request('/api/reports/generate', { method: 'POST' });
    expect((await clear(app, { confirm: 'DELETE' })).status).toBe(409);
    expect(clearData).not.toHaveBeenCalled();
  });

  it('forgets the outcome of the last report job', async () => {
    const app = appWith();
    await app.request('/api/reports/generate', { method: 'POST' });
    await settle();
    expect((await reportStatus(app)).state).toBe('succeeded');
    await clear(app, { confirm: 'DELETE' });
    expect((await reportStatus(app)).state).toBe('idle');
  });

  it('is refused when it comes from another website', async () => {
    const clearData = vi.fn(() => ({ discussions: 0, reports: 0 }));
    const response = await appWith({ clearData }).request('/api/data/clear', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'localhost:3001', origin: 'https://example.com' },
      body: JSON.stringify({ confirm: 'DELETE' }),
    });
    expect(response.status).toBe(403);
    expect(clearData).not.toHaveBeenCalled();
  });
});

describe('embedding map and retrieval statistics', () => {
  it('returns the embedding map', async () => {
    const response = await appWith().request('/api/embeddings/map');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(embeddingMap);
  });

  it('returns retrieval statistics with a default list length of 10', async () => {
    const getRetrievalStats = vi.fn(() => retrievalStats);
    const response = await appWith({ getRetrievalStats }).request('/api/retrieval/stats');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(retrievalStats);
    expect(getRetrievalStats).toHaveBeenCalledWith(10);
  });

  it('accepts a list length and rejects one out of range', async () => {
    const getRetrievalStats = vi.fn(() => retrievalStats);
    const app = appWith({ getRetrievalStats });
    await app.request('/api/retrieval/stats?limit=25');
    expect(getRetrievalStats).toHaveBeenCalledWith(25);
    expect((await app.request('/api/retrieval/stats?limit=0')).status).toBe(400);
    expect((await app.request('/api/retrieval/stats?limit=500')).status).toBe(400);
  });
});

describe('feed refresh and report generation', () => {
  it('do not run at the same time', async () => {
    let finishIngest: (value: IngestSummary) => void = () => undefined;
    const ingest = () => new Promise<IngestSummary>((resolve) => (finishIngest = resolve));
    const generateReports = vi.fn(() => new Promise<ReportRun>(() => undefined));
    const app = appWith({ ingest, generateReports });

    const refreshing = app.request('/api/ingest', { method: 'POST' });
    const blockedReport = await app.request('/api/reports/generate', { method: 'POST' });
    expect(blockedReport.status).toBe(409);
    expect(await blockedReport.json()).toMatchObject({ error: { code: 'ingest_in_progress' } });
    expect(generateReports).not.toHaveBeenCalled();

    finishIngest(summary);
    expect((await refreshing).status).toBe(200);

    expect((await app.request('/api/reports/generate', { method: 'POST' })).status).toBe(202);
    const blockedRefresh = await app.request('/api/ingest', { method: 'POST' });
    expect(blockedRefresh.status).toBe(409);
    expect(await blockedRefresh.json()).toMatchObject({ error: { code: 'report_in_progress' } });
  });
});

describe('requests from other websites', () => {
  const post = (headers: Record<string, string>) => appWith().request('/api/ingest', { method: 'POST', headers });

  it.each([
    ['the web UI through its proxy', { host: 'localhost:3000', origin: 'http://localhost:3000' }],
    ['the web UI opened by IP address', { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' }],
    ['a command-line tool calling the API directly', { host: 'localhost:3001' }],
    ['the launcher', { host: '127.0.0.1:3001' }],
  ])('accepts %s', async (_label, headers) => {
    expect((await post(headers)).status).toBe(200);
  });

  it.each([
    ['a page on another site', { host: 'localhost:3001', origin: 'https://example.com' }],
    ['a page on another local port', { host: 'localhost:3001', origin: 'http://localhost:8080' }],
    ['a sandboxed page', { host: 'localhost:3001', origin: 'null' }],
    ['a DNS-rebinding page', { host: 'attacker.example:3001' }],
  ])('refuses %s', async (_label, headers) => {
    const ingest = vi.fn(async () => summary);
    const response = await appWith({ ingest }).request('/api/ingest', { method: 'POST', headers });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'forbidden' } });
    expect(ingest).not.toHaveBeenCalled();
  });

  it('applies to read requests as well', async () => {
    const response = await appWith().request('/api/reports/latest', { headers: { host: 'attacker.example' } });
    expect(response.status).toBe(403);
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
