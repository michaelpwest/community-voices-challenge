import { useEffect, useState, type ReactNode } from 'react';
import type { HealthResponse } from '../../../src/shared/health';
import type { ReportJobStatus, ReportRun } from '../../../src/shared/reports';
import { describeCleared, describeIngest, describeStoredData, formatDateTime } from '../format';
import type { ClearState, FeedState } from '../useDashboard';
import { ClearDataForm } from './ClearDataForm';
import { Button, Disclosure, ExternalLink, Message, Panel } from './ui';

interface StatusPanelProps {
  health: HealthResponse;
  run: ReportRun | null;
  job: ReportJobStatus | null;
  feed: FeedState;
  clear: ClearState;
  onRefreshFeed: () => void;
  onGenerateReports: () => void;
  onClearData: (confirmation: string) => void;
  /** Removes the message left by the last clear attempt. */
  onDismissClearResult: () => void;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="wrap-anywhere">{children}</dd>
    </div>
  );
}

function SystemDetails({ health }: { health: HealthResponse }) {
  const { database, ollama } = health;
  const ready = health.status === 'ok';
  const title = (
    <>
      System: <span className={ready ? 'text-ok' : 'text-problem'}>{ready ? 'ready' : 'needs attention'}</span>
    </>
  );
  return (
    // Opens by itself when something needs the reviewer's attention.
    <Disclosure title={title} open={!ready}>
      <ul className="list-disc pl-5 text-sm wrap-anywhere text-muted">
        <li>
          {database.ok
            ? `Database ready (sqlite-vec ${database.vectorExtensionVersion}): ${database.path}`
            : `Database problem: ${database.error ?? 'unknown error'} (${database.path})`}
        </li>
        <li>
          {ollama.reachable
            ? `Ollama ${ollama.version ?? ''} at ${ollama.url}`
            : `Ollama is not reachable at ${ollama.url}. Start Ollama, or set OLLAMA_URL in .env. (${ollama.error ?? 'unknown error'})`}
        </li>
        {ollama.reachable &&
          ollama.models.map((model) => (
            <li key={model.name}>
              {model.available
                ? `${model.role} model ${model.name}: available`
                : `${model.role} model ${model.name}: missing. Run "ollama pull ${model.name}".`}
            </li>
          ))}
      </ul>
    </Disclosure>
  );
}

function ActivityMessages({ job, feed, clear }: Pick<StatusPanelProps, 'job' | 'feed' | 'clear'>) {
  return (
    <>
      {clear.phase === 'done' && <Message tone="ok">{describeCleared(clear.summary)}</Message>}
      {clear.phase === 'error' && <Message tone="problem">Clearing data failed: {clear.message}</Message>}
      {feed.phase === 'running' && (
        <Message tone="busy">
          Fetching the past week from the community and embedding it. This can take a minute…
        </Message>
      )}
      {feed.phase === 'done' && (
        <Message tone="ok">
          {describeIngest(feed.summary)}
          {feed.summary.embeddingError &&
            ` ${feed.summary.pendingEmbeddings} discussions could not be embedded: ${feed.summary.embeddingError}`}
        </Message>
      )}
      {feed.phase === 'error' && <Message tone="problem">Feed refresh failed: {feed.message}</Message>}
      {job?.state === 'running' && (
        <Message tone="busy">
          Generating reports with the local model: {job.step ?? 'starting'}… This can take a few minutes.
        </Message>
      )}
      {job?.state === 'failed' && (
        <Message tone="problem">Report generation failed: {job.error ?? 'unknown error'}</Message>
      )}
    </>
  );
}

export function StatusPanel(props: StatusPanelProps) {
  const { health, run, job, feed, clear, onRefreshFeed, onGenerateReports, onClearData, onDismissClearResult } = props;
  const { source, data } = health;
  const hasData = data !== null && data.posts + data.comments > 0;
  const refreshing = feed.phase === 'running';
  const generating = job?.state === 'running';
  const clearing = clear.phase === 'running';

  // The confirmation form closes by itself once the data is gone.
  const [confirmingClear, setConfirmingClear] = useState(false);
  useEffect(() => {
    if (clear.phase === 'done') setConfirmingClear(false);
  }, [clear.phase]);

  // One thing at a time: while the delete confirmation is open, nothing else can
  // be started, so the data cannot change between asking and deleting.
  const busy = refreshing || generating || clearing || confirmingClear;
  const openClearForm = (): void => {
    onDismissClearResult();
    setConfirmingClear(true);
  };
  const closeClearForm = (): void => {
    onDismissClearResult();
    setConfirmingClear(false);
  };

  return (
    <Panel aria-label="Status">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Community">
          <ExternalLink href={`${source.instanceUrl}/c/${source.community}`}>{source.community}</ExternalLink> on{' '}
          {new URL(source.instanceUrl).host}
        </Fact>
        <Fact label="Stored discussions">{describeStoredData(data)}</Fact>
        <Fact label="Last feed refresh">
          {data?.lastIngestion ? formatDateTime(data.lastIngestion.finishedAt) : 'Never'}
        </Fact>
        <Fact label="Last report">{run ? formatDateTime(run.generatedAt) : 'Not generated yet'}</Fact>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2.5">
        <Button onClick={onRefreshFeed} disabled={busy}>
          {refreshing ? 'Refreshing…' : 'Refresh feed'}
        </Button>
        <Button
          primary
          onClick={onGenerateReports}
          disabled={!hasData || busy}
          title={hasData ? undefined : 'Refresh the feed first'}
        >
          {generating ? 'Generating…' : 'Generate reports'}
        </Button>
        {/* Always available when idle: the database can hold data this page does not count,
            such as another community's, or data it could not read. */}
        <Button danger className="sm:ml-auto" onClick={openClearForm} disabled={busy}>
          Clear data
        </Button>
      </div>

      {confirmingClear && <ClearDataForm deleting={clearing} onConfirm={onClearData} onCancel={closeClearForm} />}

      <ActivityMessages job={job} feed={feed} clear={clear} />
      <SystemDetails health={health} />
    </Panel>
  );
}
