import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Discussion } from '../shared/discussions';
import { openDatabase } from './database';
import {
  contentHash,
  getDataStatus,
  listPendingEmbeddings,
  saveEmbeddings,
  searchByVector,
  upsertDiscussions,
} from './discussionStore';

const MODEL = 'test-model';
const FETCHED_AT = '2026-01-15T12:00:00.000Z';
const WINDOW = { start: new Date('2026-01-08T12:00:00Z'), end: new Date('2026-01-15T12:00:00Z') };

function discussion(overrides: Partial<Discussion> = {}): Discussion {
  return {
    id: 'lemmy:test:post:1',
    kind: 'post',
    community: 'games',
    postId: 'lemmy:test:post:1',
    title: 'A post',
    body: 'Body text',
    author: 'someone@test',
    url: 'https://test.invalid/post/1',
    linkUrl: null,
    score: 5,
    postedAt: '2026-01-14T10:00:00.000Z',
    ...overrides,
  };
}

function embed(db: DatabaseSync, item: Discussion, vector: number[], model = MODEL): void {
  saveEmbeddings(db, [
    {
      discussionId: item.id,
      model,
      contentHash: contentHash(item),
      vector: Float32Array.from(vector),
      createdAt: FETCHED_AT,
    },
  ]);
}

function countRows(db: DatabaseSync, table: 'discussions' | 'embeddings'): number {
  return Number(db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get()?.total);
}

let db: DatabaseSync;

beforeEach(() => {
  db = openDatabase(':memory:');
});

afterEach(() => {
  db.close();
});

describe('upsertDiscussions', () => {
  it('inserts new discussions', () => {
    const counts = upsertDiscussions(db, [discussion(), discussion({ id: 'lemmy:test:post:2' })], FETCHED_AT);
    expect(counts).toEqual({ inserted: 2, updated: 0, unchanged: 0 });
    expect(countRows(db, 'discussions')).toBe(2);
  });

  it('does not duplicate a discussion that is stored again', () => {
    upsertDiscussions(db, [discussion()], FETCHED_AT);
    const counts = upsertDiscussions(db, [discussion()], '2026-01-15T13:00:00.000Z');
    expect(counts).toEqual({ inserted: 0, updated: 0, unchanged: 1 });
    expect(countRows(db, 'discussions')).toBe(1);
  });

  it('counts a score change as unchanged but still stores the new score', () => {
    upsertDiscussions(db, [discussion({ score: 5 })], FETCHED_AT);
    const counts = upsertDiscussions(db, [discussion({ score: 99 })], FETCHED_AT);
    expect(counts.unchanged).toBe(1);
    expect(db.prepare('SELECT score FROM discussions').get()?.score).toBe(99);
  });

  it('updates edited text in place', () => {
    upsertDiscussions(db, [discussion()], FETCHED_AT);
    const counts = upsertDiscussions(db, [discussion({ body: 'Edited body' })], FETCHED_AT);
    expect(counts).toEqual({ inserted: 0, updated: 1, unchanged: 0 });
    expect(db.prepare('SELECT body FROM discussions').get()?.body).toBe('Edited body');
    expect(countRows(db, 'discussions')).toBe(1);
  });

  it('stores nothing when one item in the batch is invalid', () => {
    const invalid = discussion({ id: 'lemmy:test:post:2', kind: 'reply' as Discussion['kind'] });
    expect(() => upsertDiscussions(db, [discussion(), invalid], FETCHED_AT)).toThrow();
    expect(countRows(db, 'discussions')).toBe(0);
  });
});

describe('listPendingEmbeddings', () => {
  it('lists discussions that have no embedding', () => {
    upsertDiscussions(db, [discussion()], FETCHED_AT);
    expect(listPendingEmbeddings(db, MODEL).map((item) => item.discussion.id)).toEqual(['lemmy:test:post:1']);
  });

  it('omits discussions whose embedding is current', () => {
    upsertDiscussions(db, [discussion()], FETCHED_AT);
    embed(db, discussion(), [1, 0]);
    expect(listPendingEmbeddings(db, MODEL)).toEqual([]);
  });

  it('lists a discussion again after its text changes', () => {
    upsertDiscussions(db, [discussion()], FETCHED_AT);
    embed(db, discussion(), [1, 0]);
    upsertDiscussions(db, [discussion({ body: 'Edited body' })], FETCHED_AT);
    expect(listPendingEmbeddings(db, MODEL)).toHaveLength(1);
  });

  it('lists everything again when the embedding model changes', () => {
    upsertDiscussions(db, [discussion()], FETCHED_AT);
    embed(db, discussion(), [1, 0]);
    expect(listPendingEmbeddings(db, 'another-model')).toHaveLength(1);
  });

  it('replaces the old embedding rather than adding a second one', () => {
    upsertDiscussions(db, [discussion()], FETCHED_AT);
    embed(db, discussion(), [1, 0]);
    embed(db, discussion(), [0, 1], 'another-model');
    expect(countRows(db, 'embeddings')).toBe(1);
  });
});

describe('searchByVector', () => {
  const about = {
    delay: discussion({ id: 'lemmy:test:post:delay', title: 'Delay' }),
    coop: discussion({ id: 'lemmy:test:post:coop', title: 'Co-op' }),
    old: discussion({ id: 'lemmy:test:post:old', title: 'Old delay', postedAt: '2026-01-01T00:00:00.000Z' }),
    otherCommunity: discussion({ id: 'lemmy:test:post:other', title: 'Elsewhere', community: 'movies' }),
  };

  beforeEach(() => {
    upsertDiscussions(db, Object.values(about), FETCHED_AT);
    embed(db, about.delay, [1, 0]);
    embed(db, about.coop, [0, 1]);
    embed(db, about.old, [1, 0]);
    embed(db, about.otherCommunity, [1, 0]);
  });

  const search = (vector: number[], limit = 10) =>
    searchByVector(db, { vector: Float32Array.from(vector), model: MODEL, community: 'games', window: WINDOW, limit });

  it('orders results by similarity and reports it', () => {
    const results = search([0.9, 0.1]);
    expect(results.map((result) => result.id)).toEqual(['lemmy:test:post:delay', 'lemmy:test:post:coop']);
    expect(results[0]?.similarity).toBeGreaterThan(0.9);
    expect(results[1]?.similarity).toBeLessThan(0.2);
  });

  it('leaves out discussions outside the time window, however similar', () => {
    expect(search([1, 0]).map((result) => result.id)).not.toContain('lemmy:test:post:old');
  });

  it('treats the window end as exclusive and the start as inclusive', () => {
    const atStart = discussion({ id: 'lemmy:test:post:start', postedAt: '2026-01-08T12:00:00.000Z' });
    const atEnd = discussion({ id: 'lemmy:test:post:end', postedAt: '2026-01-15T12:00:00.000Z' });
    upsertDiscussions(db, [atStart, atEnd], FETCHED_AT);
    embed(db, atStart, [1, 0]);
    embed(db, atEnd, [1, 0]);
    const ids = search([1, 0]).map((result) => result.id);
    expect(ids).toContain('lemmy:test:post:start');
    expect(ids).not.toContain('lemmy:test:post:end');
  });

  it('leaves out other communities', () => {
    expect(search([1, 0]).map((result) => result.id)).not.toContain('lemmy:test:post:other');
  });

  it('returns at most the requested number of results', () => {
    expect(search([1, 1], 1)).toHaveLength(1);
  });

  it('returns source metadata with each result', () => {
    expect(search([1, 0], 1)[0]).toMatchObject({
      url: 'https://test.invalid/post/1',
      author: 'someone@test',
      postedAt: '2026-01-14T10:00:00.000Z',
      kind: 'post',
    });
  });

  it('ignores embeddings made by another model or from outdated text', () => {
    embed(db, about.coop, [1, 0], 'another-model');
    upsertDiscussions(db, [{ ...about.delay, body: 'Edited after embedding' }], FETCHED_AT);
    expect(search([1, 0])).toEqual([]);
  });
});

describe('getDataStatus', () => {
  it('reports zero for an empty database', () => {
    expect(getDataStatus(db, 'games', MODEL)).toEqual({ posts: 0, comments: 0, embedded: 0, lastIngestion: null });
  });

  it('counts posts, comments, and current embeddings for the community', () => {
    const post = discussion();
    const comment = discussion({ id: 'lemmy:test:comment:9', kind: 'comment' });
    upsertDiscussions(db, [post, comment, discussion({ id: 'lemmy:test:post:x', community: 'movies' })], FETCHED_AT);
    embed(db, post, [1, 0]);
    expect(getDataStatus(db, 'games', MODEL)).toMatchObject({ posts: 1, comments: 1, embedded: 1 });
  });
});
