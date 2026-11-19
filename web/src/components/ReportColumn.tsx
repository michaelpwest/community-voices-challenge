import type { EvidencePassage, ReportVariant } from '../../../src/shared/reports';
import { formatDuration } from '../format';
import { Eyebrow, ExternalLink, Hint } from './ui';

interface ReportColumnProps {
  variant: ReportVariant;
  evidenceByLabel: Map<string, EvidencePassage>;
  evidenceCount: number;
}

const CONFIDENCE = {
  low: { label: 'Low confidence', color: 'text-muted' },
  medium: { label: 'Medium confidence', color: 'text-warn' },
  high: { label: 'High confidence', color: 'text-ok' },
};

const ITEM_LIST = 'mt-2 divide-y divide-line *:py-3 *:first:pt-1';

/** The sources behind one theme or prediction, each linking to the original post or comment. */
function Sources({ labels, evidenceByLabel }: { labels: string[]; evidenceByLabel: Map<string, EvidencePassage> }) {
  if (labels.length === 0) return <p className="mt-1 text-sm text-muted italic">No sources cited</p>;
  return (
    <ul aria-label="Sources" className="mt-2 flex flex-wrap gap-1.5">
      {labels.map((label) => {
        const passage = evidenceByLabel.get(label);
        if (!passage) return null;
        return (
          <li key={label} className="max-w-full min-w-0">
            <ExternalLink
              href={passage.url}
              title={passage.title}
              className="flex max-w-80 items-center gap-1.5 rounded-md bg-accent-soft px-2.5 py-1.5 text-sm text-accent hover:underline"
            >
              <span className="font-bold">{label}</span>
              <span className="truncate">
                {passage.kind === 'comment' ? 'Comment on: ' : ''}
                {passage.title}
              </span>
            </ExternalLink>
          </li>
        );
      })}
    </ul>
  );
}

export function ReportColumn({ variant, evidenceByLabel, evidenceCount }: ReportColumnProps) {
  const { report } = variant;
  const isRag = variant.kind === 'rag';
  return (
    <article
      data-variant={variant.kind}
      className={`min-w-0 rounded-lg border border-t-4 border-line bg-surface p-4 ${isRag ? 'border-t-accent' : 'border-t-muted'}`}
    >
      <h3 className="text-lg font-semibold">{isRag ? 'With retrieval (RAG)' : 'Baseline (no retrieval)'}</h3>
      <Hint>
        {isRag
          ? `Based on ${evidenceCount} posts and comments retrieved from this week. Each source links to the original.`
          : 'Written from the model’s general knowledge only. This is not verified community activity.'}
      </Hint>

      <Eyebrow>Past week</Eyebrow>
      <p className="mt-1">{report.summary}</p>

      <Eyebrow>Themes</Eyebrow>
      <ul className={ITEM_LIST}>
        {report.themes.map((theme) => (
          <li key={theme.title}>
            <strong>{theme.title}</strong>
            <p className="mt-1">{theme.description}</p>
            <Sources labels={theme.sources} evidenceByLabel={evidenceByLabel} />
          </li>
        ))}
      </ul>

      <Eyebrow>Predictions for the coming week</Eyebrow>
      <Hint>Forecasts by the model, not things that have happened.</Hint>
      <ul className={ITEM_LIST}>
        {report.predictions.map((item) => (
          <li key={item.prediction}>
            <span
              className={`inline-block rounded-full border px-2 text-xs font-semibold ${CONFIDENCE[item.confidence].color}`}
            >
              {CONFIDENCE[item.confidence].label}
            </span>
            <p className="mt-1">{item.prediction}</p>
            <Hint>Why: {item.rationale}</Hint>
            <Sources labels={item.sources} evidenceByLabel={evidenceByLabel} />
          </li>
        ))}
      </ul>

      {report.limitations.length > 0 && (
        <>
          <Eyebrow>Limitations</Eyebrow>
          <ul className="mt-2 list-disc pl-5 text-sm text-muted">
            {report.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </>
      )}

      <footer className="mt-4 border-t border-line pt-3 text-sm text-muted">
        Generated in {formatDuration(variant.durationMs)}.
        {variant.invalidCitations.length > 0 &&
          ` Removed ${variant.invalidCitations.length} citation(s) that matched no evidence: ${variant.invalidCitations.join(', ')}.`}
      </footer>
    </article>
  );
}
