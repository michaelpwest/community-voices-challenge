import { Hono } from 'hono';
import type { AppConfig } from '../config/config';
import { isOllamaReady } from '../ollama/ollamaStatus';
import type { ApiErrorResponse, DatabaseStatus, HealthResponse, OllamaStatus } from '../shared/health';

export interface AppDependencies {
  config: AppConfig;
  checkOllama: () => Promise<OllamaStatus>;
  checkDatabase: () => DatabaseStatus;
}

function errorBody(code: string, message: string): ApiErrorResponse {
  return { error: { code, message } };
}

export function createApp({ config, checkOllama, checkDatabase }: AppDependencies): Hono {
  const app = new Hono();

  app.get('/api/health', async (c) => {
    const database = checkDatabase();
    const ollama = await checkOllama();
    const body: HealthResponse = {
      status: database.ok && isOllamaReady(ollama) ? 'ok' : 'degraded',
      checkedAt: new Date().toISOString(),
      database,
      ollama,
      source: config.source,
    };
    return c.json(body);
  });

  app.post('/api/ingest', (c) =>
    c.json(errorBody('not_implemented', 'Feed ingestion is not implemented yet (planned for Milestone 2).'), 501),
  );

  app.notFound((c) => c.json(errorBody('not_found', `No route for ${c.req.method} ${c.req.path}`), 404));

  app.onError((error, c) => {
    console.error('Unhandled API error:', error);
    return c.json(errorBody('internal_error', 'Unexpected server error. See the API log for details.'), 500);
  });

  return app;
}
