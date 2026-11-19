import { useCallback, useEffect, useState } from 'react';
import type { DataStatus } from '../../src/shared/discussions';
import type { HealthResponse } from '../../src/shared/health';
import { fetchHealth } from './api';

type HealthState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'loaded'; health: HealthResponse };

interface StatusCardProps {
  title: string;
  ok: boolean;
  summary: string;
  details: string[];
}

function StatusCard({ title, ok, summary, details }: StatusCardProps) {
  return (
    <section className="card">
      <h2>
        {title} <span className={ok ? 'badge ok' : 'badge problem'}>{ok ? 'Ready' : 'Needs attention'}</span>
      </h2>
      <p>{summary}</p>
      <ul>
        {details.map((detail) => (
          <li key={detail}>{detail}</li>
        ))}
      </ul>
    </section>
  );
}

function describeData(data: DataStatus | null): Omit<StatusCardProps, 'title'> {
  if (!data) return { ok: false, summary: 'Stored data could not be read.', details: [] };
  const total = data.posts + data.comments;
  if (total === 0) {
    return { ok: false, summary: 'No discussions stored yet.', details: ['Choose "Refresh feed" in the launcher.'] };
  }
  const lastRefresh = data.lastIngestion
    ? `Last refresh: ${new Date(data.lastIngestion.finishedAt).toLocaleString()}`
    : 'Last refresh: unknown';
  return {
    ok: data.embedded === total,
    summary: `${data.posts} posts and ${data.comments} comments stored`,
    details: [`${data.embedded} of ${total} embedded for search`, lastRefresh],
  };
}

function SystemStatus({ health }: { health: HealthResponse }) {
  const { database, ollama } = health;
  const missing = ollama.models.filter((model) => !model.available);
  return (
    <div className="cards">
      <StatusCard title="Community data" {...describeData(health.data)} />
      <StatusCard
        title="Database"
        ok={database.ok}
        summary={database.ok ? `SQLite with sqlite-vec ${database.vectorExtensionVersion}` : 'The database could not be opened.'}
        details={database.error ? [database.error, database.path] : [database.path]}
      />
      <StatusCard
        title="Ollama"
        ok={ollama.reachable && missing.length === 0}
        summary={
          ollama.reachable
            ? `Version ${ollama.version ?? 'unknown'} at ${ollama.url}`
            : `Not reachable at ${ollama.url}. Start Ollama, or set OLLAMA_URL in .env.`
        }
        details={
          ollama.reachable
            ? ollama.models.map((model) =>
                model.available
                  ? `${model.role} model ${model.name}: available`
                  : `${model.role} model ${model.name}: missing. Run "ollama pull ${model.name}".`,
              )
            : [ollama.error ?? 'Unknown error']
        }
      />
    </div>
  );
}

export function App() {
  const [state, setState] = useState<HealthState>({ phase: 'loading' });

  const load = useCallback((signal?: AbortSignal) => {
    setState({ phase: 'loading' });
    fetchHealth(signal)
      .then((health) => setState({ phase: 'loaded', health }))
      .catch((error: unknown) => {
        if (signal?.aborted) return;
        setState({ phase: 'error', message: error instanceof Error ? error.message : String(error) });
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const source = state.phase === 'loaded' ? state.health.source : null;

  return (
    <main>
      <header>
        <h1>Community Voices</h1>
        <p className="subtitle">
          Weekly community report, with and without retrieval.
          {source && (
            <>
              {' '}
              Community:{' '}
              <a href={`${source.instanceUrl}/c/${source.community}`} target="_blank" rel="noreferrer">
                {source.community}
              </a>
            </>
          )}
        </p>
      </header>

      <div className="toolbar">
        <h2>System status</h2>
        <button type="button" onClick={() => load()} disabled={state.phase === 'loading'}>
          {state.phase === 'loading' ? 'Checking…' : 'Check again'}
        </button>
      </div>

      {state.phase === 'loading' && <p className="notice">Checking the API, database, and Ollama…</p>}
      {state.phase === 'error' && (
        <p className="notice problem" role="alert">
          {state.message}
        </p>
      )}
      {state.phase === 'loaded' && <SystemStatus health={state.health} />}

      <p className="notice">
        Report generation is not built yet. This page currently shows setup and data status only.
      </p>
    </main>
  );
}
