import type { ReportRun, ReportVariant } from '../shared/reports';
import { plainPalette, type Palette } from './palette';

const seconds = (durationMs: number): string => `${Math.round(durationMs / 1000)}s`;
const cited = (sources: string[]): string => (sources.length > 0 ? ` [${sources.join(', ')}]` : '');

function formatVariant(heading: string, variant: ReportVariant, paint: Palette): string[] {
  return [
    '',
    paint.bold(`${heading} (${seconds(variant.durationMs)})`),
    '  Themes:',
    ...variant.report.themes.map((theme) => `    - ${theme.title}${paint.dim(cited(theme.sources))}`),
    '  Predictions for the coming week:',
    ...variant.report.predictions.map(
      (item) => `    - (${item.confidence} confidence) ${item.prediction}${paint.dim(cited(item.sources))}`,
    ),
  ];
}

/** A terminal summary of a baseline-versus-RAG run. */
export function formatReportRun(run: ReportRun, paint: Palette = plainPalette): string[] {
  const period = `${run.windowStart.slice(0, 10)} to ${run.windowEnd.slice(0, 10)}`;
  return [
    `${paint.ok('Reports generated')} for ${run.community}, ${period}, both with ${run.settings.model}.`,
    ...formatVariant('Baseline: same model, no retrieved evidence (general knowledge, not verified activity)', run.baseline, paint),
    ...formatVariant(`RAG: ${run.evidence.length} retrieved posts and comments as evidence`, run.rag, paint),
    '',
    paint.bold('Comparison'),
    ...run.evaluation.notes.map((note) => `  - ${note}`),
    ...run.warnings.map((warning) => paint.warn(`  Warning: ${warning}`)),
  ];
}
