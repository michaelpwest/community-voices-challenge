import { useCallback, useEffect, useState } from 'react';
import type { IngestSummary } from '../../src/shared/discussions';
import type { HealthResponse } from '../../src/shared/health';
import type { ReportJobStatus, ReportRun } from '../../src/shared/reports';
import {
  ApiError,
  errorMessage,
  fetchHealth,
  fetchLatestReport,
  fetchReportStatus,
  refreshFeed as requestFeedRefresh,
  startReportGeneration,
} from './api';

const REPORT_POLL_MS = 2000;

export type FeedState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'done'; summary: IngestSummary }
  | { phase: 'error'; message: string };

export interface Dashboard {
  /** True until the first load attempt has finished. */
  loading: boolean;
  /** Set when the API could not be read at all. */
  loadError: string | null;
  health: HealthResponse | null;
  /** The latest stored report run, if any. */
  run: ReportRun | null;
  /** The report generation job on the server. */
  job: ReportJobStatus | null;
  feed: FeedState;
  reload: () => void;
  refreshFeed: () => void;
  generateReports: () => void;
}

function failedJob(message: string): ReportJobStatus {
  return { state: 'failed', step: null, startedAt: null, finishedAt: new Date().toISOString(), error: message };
}

/** Loads everything the page shows and exposes the two actions a reviewer can take. */
export function useDashboard(): Dashboard {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [run, setRun] = useState<ReportRun | null>(null);
  const [job, setJob] = useState<ReportJobStatus | null>(null);
  const [feed, setFeed] = useState<FeedState>({ phase: 'idle' });

  const load = useCallback(async () => {
    try {
      const [nextHealth, nextRun, nextJob] = await Promise.all([fetchHealth(), fetchLatestReport(), fetchReportStatus()]);
      setHealth(nextHealth);
      setRun(nextRun);
      setJob(nextJob);
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // While reports are being generated (started here, in the launcher, or before
  // a page reload), follow the job until it finishes, then load the new run.
  const generating = job?.state === 'running';
  useEffect(() => {
    if (!generating) return;
    const timer = setInterval(() => {
      fetchReportStatus()
        .then(async (next) => {
          setJob(next);
          if (next.state !== 'running') await load();
        })
        .catch((error: unknown) => setJob(failedJob(errorMessage(error))));
    }, REPORT_POLL_MS);
    return () => clearInterval(timer);
  }, [generating, load]);

  const generateReports = useCallback(() => {
    startReportGeneration()
      .then(setJob)
      .catch((error: unknown) => {
        // Already running (for example, started from the launcher): follow that job instead.
        if (error instanceof ApiError && error.code === 'report_in_progress') void load();
        else setJob(failedJob(errorMessage(error)));
      });
  }, [load]);

  const refreshFeed = useCallback(() => {
    setFeed({ phase: 'running' });
    requestFeedRefresh()
      .then(async (summary) => {
        setFeed({ phase: 'done', summary });
        await load();
      })
      .catch((error: unknown) => setFeed({ phase: 'error', message: errorMessage(error) }));
  }, [load]);

  const reload = useCallback(() => {
    setLoading(true);
    void load();
  }, [load]);

  return { loading, loadError, health, run, job, feed, reload, refreshFeed, generateReports };
}
