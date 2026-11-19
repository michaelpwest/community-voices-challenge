import type { IngestSummary } from '../../src/shared/discussions';
import type { ApiErrorResponse, HealthResponse } from '../../src/shared/health';
import type { ReportJobStatus, ReportRun } from '../../src/shared/reports';

/** A failed API call, with a message suitable for showing to the user. */
export class ApiError extends Error {
  constructor(
    message: string,
    /** HTTP status, or null when the API could not be reached at all. */
    readonly status: number | null,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError('The app’s API is not reachable. Start it with "npm start", then try again.', null);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as Partial<ApiErrorResponse> | null)?.error;
    // A proxy error (API process not running) has no JSON error body.
    const message = error?.message ?? `The app’s API is not responding (HTTP ${response.status}). Is it still running?`;
    throw new ApiError(message, response.status, error?.code ?? null);
  }
  return body as T;
}

export const fetchHealth = (): Promise<HealthResponse> => request('/api/health');

export const fetchReportStatus = (): Promise<ReportJobStatus> => request('/api/reports/status');

/** Returns null when no report has been generated yet. */
export async function fetchLatestReport(): Promise<ReportRun | null> {
  try {
    return await request<ReportRun>('/api/reports/latest');
  } catch (error) {
    if (error instanceof ApiError && error.code === 'no_report') return null;
    throw error;
  }
}

/** Starts report generation in the background; poll fetchReportStatus for progress. */
export const startReportGeneration = (): Promise<ReportJobStatus> =>
  request('/api/reports/generate', { method: 'POST' });

/** Fetches and embeds the past week. Resolves when the refresh has finished. */
export const refreshFeed = (): Promise<IngestSummary> => request('/api/ingest', { method: 'POST' });

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
