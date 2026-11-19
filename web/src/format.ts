import type { DataStatus, IngestSummary } from '../../src/shared/discussions';
import type { EvidencePassage, EvidenceSelection } from '../../src/shared/reports';

const LOCALE = 'en-US';

/** A date and time in the viewer's own time zone, e.g. "Nov 19, 2026, 8:25 AM". */
export function formatDateTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(iso));
}

/** A short UTC date, e.g. "Nov 12". Report periods are defined in UTC. */
export function formatUtcDay(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(iso));
}

/** A report period, e.g. "Nov 12 to Nov 19, 2026 (UTC)". */
export function formatPeriod(startIso: string, endIso: string): string {
  const year = new Date(endIso).getUTCFullYear();
  return `${formatUtcDay(startIso)} to ${formatUtcDay(endIso)}, ${year} (UTC)`;
}

export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} s`;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

/** "12 of 15", or "None" when there is nothing to count. */
export function formatShare(part: number, total: number): string {
  return total === 0 ? 'None' : `${part} of ${total}`;
}

/** Why a passage was included in the evidence, in plain words. */
export function describeSelection(selectedBy: EvidenceSelection[]): string {
  const reasons = selectedBy.map((selection) =>
    selection.method === 'engagement'
      ? 'among the week’s highest-scored discussions'
      : `similar to the query "${selection.query ?? ''}" (${(selection.similarity ?? 0).toFixed(2)})`,
  );
  return [...new Set(reasons)].join('; ');
}

/** Looks up evidence passages by citation label. */
export function indexEvidence(evidence: EvidencePassage[]): Map<string, EvidencePassage> {
  return new Map(evidence.map((passage) => [passage.label, passage]));
}

export function describeStoredData(data: DataStatus | null): string {
  if (!data) return 'Could not be read';
  const total = data.posts + data.comments;
  if (total === 0) return 'Nothing stored yet';
  const embedded = data.embedded === total ? 'all embedded for search' : `${data.embedded} of ${total} embedded for search`;
  return `${data.posts} posts and ${data.comments} comments, ${embedded}`;
}

export function describeIngest(summary: IngestSummary): string {
  return (
    `Feed refreshed: ${summary.fetchedPosts} posts and ${summary.fetchedComments} comments from the past week ` +
    `(${summary.inserted} new, ${summary.updated} changed, ${summary.unchanged} unchanged).`
  );
}
