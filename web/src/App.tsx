import type { HealthResponse } from '../../src/shared/health';
import type { ReportRun } from '../../src/shared/reports';
import { ComparisonPanel } from './components/ComparisonPanel';
import { EmbeddingMapPanel } from './components/EmbeddingMapPanel';
import { EvidenceList } from './components/EvidenceList';
import { RetrievalStatsPanel } from './components/RetrievalStatsPanel';
import { ReportColumn } from './components/ReportColumn';
import { StatusPanel } from './components/StatusPanel';
import { Button, Hint, Message, Panel } from './components/ui';
import { formatDateTime, formatPeriod, indexEvidence } from './format';
import { useDashboard } from './useDashboard';

function ReportView({ run, feedRefreshedAt }: { run: ReportRun; feedRefreshedAt: string | null }) {
  const evidenceByLabel = indexEvidence(run.evidence);
  const olderThanFeed = feedRefreshedAt !== null && Date.parse(feedRefreshedAt) > Date.parse(run.generatedAt);
  return (
    <section aria-labelledby="report-heading">
      <header className="mt-6">
        <h2 id="report-heading" className="text-xl font-semibold">
          Weekly report: {formatPeriod(run.windowStart, run.windowEnd)}
        </h2>
        <Hint>
          Generated {formatDateTime(run.generatedAt)} by {run.settings.model}. Both versions used the same model,
          instructions, and settings; only the retrieved evidence differs.
        </Hint>
      </header>

      {olderThanFeed && (
        <Message tone="notice">
          The feed has been refreshed since this report was written. Choose Generate reports to include the newest
          discussions.
        </Message>
      )}
      {run.warnings.map((warning) => (
        <Message key={warning} tone="problem">
          {warning}
        </Message>
      ))}

      {/* Side by side on wide screens, stacked on phones. */}
      <div className="mt-3 mb-4 grid items-start gap-4 lg:grid-cols-2">
        <ReportColumn variant={run.rag} evidenceByLabel={evidenceByLabel} evidenceCount={run.evidence.length} />
        <ReportColumn variant={run.baseline} evidenceByLabel={evidenceByLabel} evidenceCount={0} />
      </div>

      <ComparisonPanel run={run} />
      <EvidenceList run={run} />
    </section>
  );
}

/** What to show in place of a report when there is none yet. */
function EmptyState({ health }: { health: HealthResponse }) {
  const stored = (health.data?.posts ?? 0) + (health.data?.comments ?? 0);
  return (
    <Panel aria-label="Getting started">
      <h2 className="text-xl font-semibold">{stored === 0 ? 'No community data yet' : 'No report yet'}</h2>
      <p className="mt-1 max-w-2xl">
        {stored === 0 ? (
          <>
            Choose <strong>Refresh feed</strong> to load the past week of posts and comments from the community. This
            needs internet access and takes about a minute.
          </>
        ) : (
          <>
            Choose <strong>Generate reports</strong> to have the local model write two versions of the weekly report:
            one using posts retrieved from this week, and a baseline without them.
          </>
        )}
      </p>
    </Panel>
  );
}

export function App() {
  const dashboard = useDashboard();
  const { loading, loadError, health, run, embeddingMap, retrieval } = dashboard;

  return (
    <main className="mx-auto max-w-7xl px-4 pt-6 pb-12">
      <header className="mb-5">
        <h1 className="text-3xl font-bold">Community Voices</h1>
        <p className="text-muted">A weekly community report from a local model, with and without retrieval.</p>
      </header>

      {loading && !health && <Panel>Loading…</Panel>}

      {loadError && (
        <Message tone="problem">
          <p>{loadError}</p>
          <Button className="mt-2 text-ink" onClick={dashboard.reload} disabled={loading}>
            {loading ? 'Trying…' : 'Try again'}
          </Button>
        </Message>
      )}

      {health && (
        <>
          <StatusPanel
            health={health}
            run={run}
            job={dashboard.job}
            feed={dashboard.feed}
            clear={dashboard.clear}
            onRefreshFeed={dashboard.refreshFeed}
            onGenerateReports={dashboard.generateReports}
            onClearData={dashboard.clearData}
          />
          {run ? (
            <ReportView run={run} feedRefreshedAt={health.data?.lastIngestion?.finishedAt ?? null} />
          ) : (
            <EmptyState health={health} />
          )}
          {embeddingMap && retrieval && embeddingMap.points.length > 0 && (
            <section aria-labelledby="retrieval-heading">
              <h2 id="retrieval-heading" className="mt-6 mb-3 text-xl font-semibold">
                Inside the retrieval
              </h2>
              <EmbeddingMapPanel map={embeddingMap} />
              <RetrievalStatsPanel stats={retrieval} />
            </section>
          )}
        </>
      )}
    </main>
  );
}
