/** A half-open span of time: start is included, end is not. */
export interface TimeWindow {
  start: Date;
  end: Date;
}

export const REPORT_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The reporting window: the 168 hours ending at `now`. It is a rolling span of
 * exact instants, not calendar days, so it does not depend on any time zone.
 */
export function lastSevenDays(now: Date): TimeWindow {
  return { start: new Date(now.getTime() - REPORT_WINDOW_DAYS * DAY_MS), end: now };
}

const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Parses a source timestamp. A timestamp without a zone is read as UTC, which
 * is what Lemmy means when it omits one. Returns null when it is not a date.
 */
export function parseUtcTimestamp(value: string): Date | null {
  const trimmed = value.trim();
  const parsed = new Date(HAS_ZONE.test(trimmed) ? trimmed : `${trimmed}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
