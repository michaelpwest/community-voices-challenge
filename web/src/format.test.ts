import { describe, expect, it } from 'vitest';
import type { IngestSummary } from '../../src/shared/discussions';
import type { EvidencePassage } from '../../src/shared/reports';
import {
  describeIngest,
  describeSelection,
  describeStoredData,
  formatDateTime,
  formatDuration,
  formatPeriod,
  formatShare,
  indexEvidence,
} from './format';

describe('formatPeriod', () => {
  it('shows the report period in UTC with the year', () => {
    expect(formatPeriod('2026-11-12T13:25:00.000Z', '2026-11-19T13:25:00.000Z')).toBe('Nov 12 to Nov 19, 2026 (UTC)');
  });

  it('uses the UTC date even when the local date would differ', () => {
    // 23:30 UTC is already the next day in zones east of UTC and still the same day west of it.
    expect(formatPeriod('2026-12-25T23:30:00.000Z', '2027-01-01T23:30:00.000Z')).toBe('Dec 25 to Jan 1, 2027 (UTC)');
  });
});

describe('formatDateTime', () => {
  it('formats a time in the requested zone', () => {
    expect(formatDateTime('2026-11-19T13:25:24.043Z', 'America/Chicago')).toBe('Nov 19, 2026, 7:25 AM');
    expect(formatDateTime('2026-11-19T13:25:24.043Z', 'UTC')).toBe('Nov 19, 2026, 1:25 PM');
  });
});

describe('formatDuration', () => {
  it.each([
    [400, '1 s'],
    [15_600, '16 s'],
    [60_000, '1 min'],
    [125_000, '2 min 5 s'],
  ])('formats %i ms as %s', (durationMs, expected) => {
    expect(formatDuration(durationMs)).toBe(expected);
  });
});

describe('formatShare', () => {
  it('shows a part of a total, or None for an empty total', () => {
    expect(formatShare(8, 8)).toBe('8 of 8');
    expect(formatShare(0, 6)).toBe('0 of 6');
    expect(formatShare(0, 0)).toBe('None');
  });
});

describe('describeSelection', () => {
  it('explains engagement and similarity selection', () => {
    expect(describeSelection([{ method: 'engagement', query: null, similarity: null }])).toBe(
      'among the week’s highest-scored discussions',
    );
    expect(describeSelection([{ method: 'similarity', query: 'industry and business news', similarity: 0.6123 }])).toBe(
      'similar to the query "industry and business news" (0.61)',
    );
  });

  it('joins several reasons and drops exact repeats', () => {
    const engagement = { method: 'engagement' as const, query: null, similarity: null };
    const similar = { method: 'similarity' as const, query: 'new releases', similarity: 0.7 };
    expect(describeSelection([engagement, similar, engagement])).toBe(
      'among the week’s highest-scored discussions; similar to the query "new releases" (0.70)',
    );
  });
});

describe('indexEvidence', () => {
  it('finds a passage by its citation label', () => {
    const passages = [{ label: 'S1', title: 'First' }, { label: 'S2', title: 'Second' }] as EvidencePassage[];
    const byLabel = indexEvidence(passages);
    expect(byLabel.get('S2')?.title).toBe('Second');
    expect(byLabel.get('S9')).toBeUndefined();
  });
});

describe('describeStoredData', () => {
  it('covers unreadable, empty, fully embedded, and partly embedded data', () => {
    expect(describeStoredData(null)).toBe('Could not be read');
    expect(describeStoredData({ posts: 0, comments: 0, embedded: 0, lastIngestion: null })).toBe('Nothing stored yet');
    expect(describeStoredData({ posts: 45, comments: 315, embedded: 360, lastIngestion: null })).toBe(
      '45 posts and 315 comments, all embedded for search',
    );
    expect(describeStoredData({ posts: 2, comments: 3, embedded: 4, lastIngestion: null })).toBe(
      '2 posts and 3 comments, 4 of 5 embedded for search',
    );
  });
});

describe('describeIngest', () => {
  it('summarizes a refresh', () => {
    const summary = { fetchedPosts: 45, fetchedComments: 313, inserted: 2, updated: 1, unchanged: 355 } as IngestSummary;
    expect(describeIngest(summary)).toBe(
      'Feed refreshed: 45 posts and 313 comments from the past week (2 new, 1 changed, 355 unchanged).',
    );
  });
});
