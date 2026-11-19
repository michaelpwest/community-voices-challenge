import { Hono } from 'hono';
import { z } from 'zod';
import type { AppConfig } from '../config/config';
import { EmbeddingError } from '../ollama/embeddings';
import { isOllamaReady } from '../ollama/ollamaStatus';
import { DEFAULT_TOP_K, MAX_TOP_K } from '../retrieval/retrieval';
import type { DataStatus, IngestSummary, SearchResponse } from '../shared/discussions';
import type { ApiErrorResponse, DatabaseStatus, HealthResponse, OllamaStatus } from '../shared/health';
import { SourceError } from '../sources/discussionSource';

export interface AppDependencies {
  config: AppConfig;
  checkOllama: () => Promise<OllamaStatus>;
  checkDatabase: () => DatabaseStatus;
  getDataStatus: () => DataStatus;
  ingest: () => Promise<IngestSummary>;
  search: (query: string, topK: number) => Promise<SearchResponse>;
}

const searchQuerySchema = z.object({
  q: z.string().trim().min(1, 'q must not be empty').max(500, 'q must be at most 500 characters'),
  k: z.coerce.number().int().min(1).max(MAX_TOP_K).default(DEFAULT_TOP_K),
});

function errorBody(code: string, message: string): ApiErrorResponse {
  return { error: { code, message } };
}

export function createApp(dependencies: AppDependencies): Hono {
  const { config, checkOllama, checkDatabase, getDataStatus, ingest, search } = dependencies;
  const app = new Hono();
  let ingestInProgress = false;

  function readDataStatus(): DataStatus | null {
    try {
      return getDataStatus();
    } catch (error) {
      console.error('Could not read stored data status:', error);
      return null;
    }
  }

  app.get('/api/health', async (c) => {
    const database = checkDatabase();
    const ollama = await checkOllama();
    const body: HealthResponse = {
      status: database.ok && isOllamaReady(ollama) ? 'ok' : 'degraded',
      checkedAt: new Date().toISOString(),
      database,
      ollama,
      source: { instanceUrl: config.source.instanceUrl, community: config.source.community },
      data: readDataStatus(),
    };
    return c.json(body);
  });

  // Runs to completion before answering; a full refresh takes roughly a minute.
  app.post('/api/ingest', async (c) => {
    if (ingestInProgress) {
      return c.json(errorBody('ingest_in_progress', 'A feed refresh is already running. Try again when it finishes.'), 409);
    }
    ingestInProgress = true;
    try {
      return c.json(await ingest());
    } catch (error) {
      if (error instanceof SourceError) return c.json(errorBody('source_unavailable', error.message), 502);
      throw error;
    } finally {
      ingestInProgress = false;
    }
  });

  app.get('/api/search', async (c) => {
    const parsed = searchQuerySchema.safeParse({ q: c.req.query('q') ?? '', k: c.req.query('k') });
    if (!parsed.success) {
      const message = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
      return c.json(errorBody('invalid_request', message), 400);
    }
    try {
      return c.json(await search(parsed.data.q, parsed.data.k));
    } catch (error) {
      if (error instanceof EmbeddingError) return c.json(errorBody('ollama_unavailable', error.message), 503);
      throw error;
    }
  });

  app.notFound((c) => c.json(errorBody('not_found', `No route for ${c.req.method} ${c.req.path}`), 404));

  app.onError((error, c) => {
    console.error('Unhandled API error:', error);
    return c.json(errorBody('internal_error', 'Unexpected server error. See the API log for details.'), 500);
  });

  return app;
}
