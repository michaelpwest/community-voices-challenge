import { Hono } from 'hono';
import { z } from 'zod';
import type { AppConfig } from '../config/config';
import { GenerationError } from '../ollama/chat';
import { EmbeddingError } from '../ollama/embeddings';
import { isOllamaReady } from '../ollama/ollamaStatus';
import { ReportFormatError } from '../reports/reportSchema';
import { NoDataError } from '../reports/reportService';
import { DEFAULT_TOP_K, MAX_TOP_K } from '../retrieval/retrieval';
import type { DataStatus, IngestSummary, SearchResponse } from '../shared/discussions';
import type { ApiErrorResponse, DatabaseStatus, HealthResponse, OllamaStatus } from '../shared/health';
import type { ReportJobStatus, ReportRun } from '../shared/reports';
import { SourceError } from '../sources/discussionSource';

export interface AppDependencies {
  config: AppConfig;
  checkOllama: () => Promise<OllamaStatus>;
  checkDatabase: () => DatabaseStatus;
  getDataStatus: () => DataStatus;
  ingest: () => Promise<IngestSummary>;
  search: (query: string, topK: number) => Promise<SearchResponse>;
  /** Generates and stores the baseline and RAG reports, reporting each stage through `onStep`. */
  generateReports: (onStep: (step: string) => void) => Promise<ReportRun>;
  getLatestReport: () => ReportRun | null;
}

/** Failures whose message is written for the user and safe to show. */
const EXPECTED_REPORT_ERRORS = [NoDataError, EmbeddingError, GenerationError, ReportFormatError];

const IDLE_REPORT_JOB: ReportJobStatus = { state: 'idle', step: null, startedAt: null, finishedAt: null, error: null };

const searchQuerySchema = z.object({
  q: z.string().trim().min(1, 'q must not be empty').max(500, 'q must be at most 500 characters'),
  k: z.coerce.number().int().min(1).max(MAX_TOP_K).default(DEFAULT_TOP_K),
});

function errorBody(code: string, message: string): ApiErrorResponse {
  return { error: { code, message } };
}

export function createApp(dependencies: AppDependencies): Hono {
  const { config, checkOllama, checkDatabase, getDataStatus, ingest, search } = dependencies;
  const { generateReports, getLatestReport } = dependencies;
  const app = new Hono();
  let ingestInProgress = false;
  let reportJob: ReportJobStatus = IDLE_REPORT_JOB;

  /** Runs in the background; its progress and outcome are read through /api/reports/status. */
  async function runReportJob(startedAt: string): Promise<void> {
    const finish = (state: 'succeeded' | 'failed', error: string | null): void => {
      reportJob = { state, step: null, startedAt, finishedAt: new Date().toISOString(), error };
    };
    try {
      await generateReports((step) => {
        reportJob = { ...reportJob, step };
      });
      finish('succeeded', null);
    } catch (error) {
      if (EXPECTED_REPORT_ERRORS.some((expected) => error instanceof expected)) {
        finish('failed', (error as Error).message);
      } else {
        console.error('Report generation failed unexpectedly:', error);
        finish('failed', 'Unexpected error while generating the reports. See the API log for details.');
      }
    }
  }

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

  // Generation takes minutes, so this starts it and returns; clients poll the status route.
  app.post('/api/reports/generate', (c) => {
    if (reportJob.state === 'running') {
      return c.json(errorBody('report_in_progress', 'Reports are already being generated.'), 409);
    }
    const startedAt = new Date().toISOString();
    reportJob = { state: 'running', step: 'Starting', startedAt, finishedAt: null, error: null };
    void runReportJob(startedAt);
    return c.json(reportJob, 202);
  });

  app.get('/api/reports/status', (c) => c.json(reportJob));

  app.get('/api/reports/latest', (c) => {
    const run = getLatestReport();
    return run ? c.json(run) : c.json(errorBody('no_report', 'No report has been generated yet.'), 404);
  });

  app.notFound((c) => c.json(errorBody('not_found', `No route for ${c.req.method} ${c.req.path}`), 404));

  app.onError((error, c) => {
    console.error('Unhandled API error:', error);
    return c.json(errorBody('internal_error', 'Unexpected server error. See the API log for details.'), 500);
  });

  return app;
}
