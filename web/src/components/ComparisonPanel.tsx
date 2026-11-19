import type { ReportRun, VariantMetrics } from '../../../src/shared/reports';
import { formatDuration, formatShare } from '../format';
import { Hint, Panel } from './ui';

interface Row {
  check: string;
  value: (metrics: VariantMetrics, durationMs: number) => string;
}

const ROWS: Row[] = [
  {
    check: 'Themes and predictions that cite a source',
    value: (metrics) => formatShare(metrics.citedItems, metrics.themes + metrics.predictions),
  },
  { check: 'Distinct sources cited', value: (metrics) => String(metrics.distinctSources) },
  {
    check: 'Names and numbers that appear in this week’s discussions',
    value: (metrics) => formatShare(metrics.namedTermsFound, metrics.namedTerms),
  },
  {
    check: 'Names and numbers not found this week',
    value: (metrics) => (metrics.namedTermsNotFound.length > 0 ? metrics.namedTermsNotFound.join(', ') : 'None'),
  },
  {
    check: 'High-confidence predictions',
    value: (metrics) =>
      metrics.uncitedHighConfidencePredictions > 0
        ? `${metrics.highConfidencePredictions} (${metrics.uncitedHighConfidencePredictions} without a source)`
        : String(metrics.highConfidencePredictions),
  },
  { check: 'Citations removed for matching no evidence', value: (metrics) => String(metrics.invalidCitations) },
  { check: 'Time to generate', value: (_metrics, durationMs) => formatDuration(durationMs) },
];

const CELL = 'border-t border-line px-2.5 py-2 text-left align-top wrap-anywhere';
const COLUMN_HEADING = 'px-2.5 py-2 text-left text-xs font-semibold text-muted';

/** The same automatic checks applied to both reports, side by side. */
export function ComparisonPanel({ run }: { run: ReportRun }) {
  const { evaluation, baseline, rag } = run;
  return (
    <Panel aria-labelledby="comparison-heading">
      <h3 id="comparison-heading" className="text-lg font-semibold">
        How the two reports compare
      </h3>
      <table className="mt-3 mb-2 w-full text-sm">
        <thead>
          <tr>
            <th scope="col" className={COLUMN_HEADING}>
              Check
            </th>
            <th scope="col" className={COLUMN_HEADING}>
              With retrieval
            </th>
            <th scope="col" className={COLUMN_HEADING}>
              Baseline
            </th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.check}>
              <th scope="row" className={`${CELL} w-[44%] font-normal`}>
                {row.check}
              </th>
              <td className={CELL}>{row.value(evaluation.rag, rag.durationMs)}</td>
              <td className={CELL}>{row.value(evaluation.baseline, baseline.durationMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Hint>
        Automatic text checks against the stored discussions. They indicate how grounded each report is; they do not
        grade writing quality, and a name counts as found if the word appears anywhere in the week.
      </Hint>
    </Panel>
  );
}
