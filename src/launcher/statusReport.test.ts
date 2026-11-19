import { describe, expect, it } from 'vitest';
import type { IngestSummary } from '../shared/discussions';
import type { HealthResponse } from '../shared/health';
import { formatHealth, formatIngestSummary } from './statusReport';

const summary: IngestSummary = {
  source: 'lemmy:lemmy.world',
  community: 'games',
  windowStart: '2026-01-08T12:00:00.000Z',
  windowEnd: '2026-01-15T12:00:00.000Z',
  startedAt: '2026-01-15T12:00:00.000Z',
  finishedAt: '2026-01-15T12:00:40.000Z',
  fetchedPosts: 47,
  fetchedComments: 380,
  inserted: 12,
  updated: 3,
  unchanged: 412,
  embedded: 15,
  pendingEmbeddings: 0,
  embeddingError: null,
};

const health: HealthResponse = {
  status: 'degraded',
  checkedAt: '2026-11-18T12:00:00.000Z',
  database: { path: '/project/data/app.db', ok: true, vectorExtensionVersion: 'v0.1.9', error: null },
  ollama: {
    url: 'http://localhost:11434',
    reachable: true,
    version: '0.99.0',
    models: [
      { name: 'llama3.1:8b', role: 'generation', available: true },
      { name: 'nomic-embed-text', role: 'embedding', available: false },
    ],
    error: null,
  },
  source: { instanceUrl: 'https://lemmy.world', community: 'games' },
  data: { posts: 47, comments: 380, embedded: 427, lastIngestion: summary },
};

describe('formatHealth', () => {
  it('shows each component and the command that fixes a missing model', () => {
    const text = formatHealth(health).join('\n');
    expect(text).toContain('Overall:   degraded');
    expect(text).toContain('sqlite-vec v0.1.9');
    expect(text).toContain('generation model llama3.1:8b: available');
    expect(text).toContain('MISSING (run: ollama pull nomic-embed-text)');
    expect(text).toContain('games on https://lemmy.world');
    expect(text).toContain('Data:      47 posts and 380 comments, all embedded, last refresh 2026-01-15T12:00:40.000Z');
  });

  it('explains an unreachable Ollama and a failed database', () => {
    const text = formatHealth({
      ...health,
      database: { ...health.database, ok: false, vectorExtensionVersion: null, error: 'unable to open' },
      ollama: { ...health.ollama, reachable: false, version: null, error: 'connect ECONNREFUSED' },
    }).join('\n');
    expect(text).toContain('Database:  ERROR at /project/data/app.db (unable to open)');
    expect(text).toContain('NOT REACHABLE at http://localhost:11434 (connect ECONNREFUSED)');
  });

  it('describes empty, partly embedded, and unreadable data', () => {
    const dataLine = (data: HealthResponse['data']): string => formatHealth({ ...health, data }).at(-1) ?? '';
    expect(dataLine({ posts: 0, comments: 0, embedded: 0, lastIngestion: null })).toContain('empty');
    expect(dataLine({ posts: 2, comments: 3, embedded: 4, lastIngestion: null })).toContain('4 of 5 embedded');
    expect(dataLine(null)).toContain('could not be read');
  });
});

describe('formatIngestSummary', () => {
  it('summarizes a refresh on one line', () => {
    expect(formatIngestSummary(summary)).toEqual([
      'Feed refreshed: 47 posts and 380 comments from the past week (12 new, 3 changed, 412 unchanged). Embedded 15.',
    ]);
  });

  it('adds a warning when embedding did not finish', () => {
    const lines = formatIngestSummary({
      ...summary,
      embedded: 0,
      pendingEmbeddings: 15,
      embeddingError: 'Ollama is not reachable at http://localhost:11434.',
    });
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('15 discussions are stored but not embedded yet: Ollama is not reachable');
  });
});
