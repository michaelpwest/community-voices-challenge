import type { ReportRun } from '../../../src/shared/reports';
import { describeSelection, formatDateTime, formatUtcDay } from '../format';
import { Disclosure, ExternalLink, Hint, Panel } from './ui';

/** The passages given to the RAG run, and the settings shared by both runs. Collapsed by default. */
export function EvidenceList({ run }: { run: ReportRun }) {
  const { evidence, settings } = run;
  const sharedSettings = [
    ['Model', settings.model],
    ['Embedding model', settings.embeddingModel],
    ['Context window', `${settings.numCtx} tokens`],
    ['Temperature', String(settings.temperature)],
    ['Seed', String(settings.seed)],
    ['Output limit', `${settings.maxOutputTokens} tokens`],
    ['Prompt version', settings.promptVersion],
    ['Community data refreshed', run.dataRefreshedAt ? formatDateTime(run.dataRefreshedAt) : 'Unknown'],
  ];

  return (
    <Panel aria-label="Evidence and settings" className="*:first:mt-0">
      <Disclosure title={`Evidence given to the retrieval run (${evidence.length} posts and comments)`}>
        <Hint>The baseline run was given none of these.</Hint>
        <ol aria-label="Evidence" className="mt-2 divide-y divide-line *:py-3">
          {evidence.map((passage) => (
            <li key={passage.label} className="wrap-anywhere">
              <span className="mr-2 font-bold">{passage.label}</span>
              <ExternalLink href={passage.url}>
                {passage.kind === 'comment' ? 'Comment on: ' : ''}
                {passage.title}
              </ExternalLink>
              <Hint>
                {passage.kind === 'post' ? 'Post' : 'Comment'}, {formatUtcDay(passage.postedAt)}, score {passage.score}.
                Included because it was {describeSelection(passage.selectedBy)}.
              </Hint>
              {passage.excerpt && <p className="mt-1.5 border-l-4 border-line pl-3 text-sm">{passage.excerpt}</p>}
            </li>
          ))}
        </ol>
      </Disclosure>

      <Disclosure title="Settings shared by both runs">
        <dl className="mt-2 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          {sharedSettings.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="wrap-anywhere">{value}</dd>
            </div>
          ))}
        </dl>
      </Disclosure>
    </Panel>
  );
}
