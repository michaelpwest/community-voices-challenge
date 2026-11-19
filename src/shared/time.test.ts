import { describe, expect, it } from 'vitest';
import { lastSevenDays, parseUtcTimestamp } from './time';

describe('lastSevenDays', () => {
  it('spans exactly 168 hours ending at the given moment', () => {
    const window = lastSevenDays(new Date('2026-01-15T12:00:00Z'));
    expect(window.start.toISOString()).toBe('2026-01-08T12:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-01-15T12:00:00.000Z');
  });

  it('is not shifted by a daylight-saving change inside the window', () => {
    // US clocks changed on 2026-03-08; the window is still 168 real hours.
    const window = lastSevenDays(new Date('2026-03-10T15:00:00Z'));
    expect(window.end.getTime() - window.start.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe('parseUtcTimestamp', () => {
  it('reads Lemmy timestamps with microseconds and a Z', () => {
    expect(parseUtcTimestamp('2026-11-19T12:56:16.695906Z')?.toISOString()).toBe('2026-11-19T12:56:16.695Z');
  });

  it('treats a timestamp without a zone as UTC', () => {
    expect(parseUtcTimestamp('2026-01-10T07:15:00.123456')?.toISOString()).toBe('2026-01-10T07:15:00.123Z');
  });

  it('converts an explicit offset to UTC', () => {
    expect(parseUtcTimestamp('2026-01-10T09:15:00+02:00')?.toISOString()).toBe('2026-01-10T07:15:00.000Z');
  });

  it('returns null for text that is not a date', () => {
    expect(parseUtcTimestamp('yesterday')).toBeNull();
    expect(parseUtcTimestamp('')).toBeNull();
  });
});
