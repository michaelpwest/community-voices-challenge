import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Discussion } from '../shared/discussions';
import { openDatabase } from './database';
import { contentHash, saveEmbeddings, upsertDiscussions } from './discussionStore';
import { getRetrievalStats, listEmbeddings, recordRetrievals } from './insightStore';

const MODEL = 'test-model';
const NOW = '2026-01-15T12:00:00.000Z';
const WINDOW = { start: new Date('2026-01-08T12:00:00Z'), end: new Date('2026-01-15T12:00:00Z') };

function discussion(name: string, overrides: Partial<Discussion> = {}): Discussion {
  return {
    id: `lemmy:test:post:${name}`,
    kind: 'post',
    community: 'games',
    postId: `lemmy:test:post:${name}`,
    title: `Post ${name}`,
    body: 'Body',
    author: null,
    url: `https://test.invalid/post/${name}`,
    linkUrl: null,
    score: 1,
    postedAt: '2026-01-14T10:00:00.000Z',
    ...overrides,
  };
}

let db: DatabaseSync;

function store(item: Discussion, vector: number[] | null = [1, 0], model = MODEL): Discussion {
  upsertDiscussions(db, [item], NOW);
  if (vector) {
    saveEmbeddings(db, [
      { discussionId: item.id, model, contentHash: contentHash(item), vector: Float32Array.from(vector), createdAt: NOW },
    ]);
  }
  return item;
}

beforeEach(() => {
  db = openDatabase(':memory:');
});

afterEach(() => {
  db.close();
});

describe('retrieval statistics', () => {
  it('starts with nothing counted', () => {
    expect(getRetrievalStats(db, 'games', 10)).toEqual({ totalRetrievals: 0, discussionsRetrieved: 0, top: [] });
  });

  it('counts each retrieval and lists the most-retrieved discussions first', () => {
    const a = store(discussion('a'));
    const b = store(discussion('b'));
    const c = store(discussion('c'));
    recordRetrievals(db, [a.id, b.id], '2026-01-15T12:00:00.000Z');
    recordRetrievals(db, [b.id, c.id], '2026-01-15T12:01:00.000Z');
    recordRetrievals(db, [b.id], '2026-01-15T12:02:00.000Z');

    const stats = getRetrievalStats(db, 'games', 10);
    expect(stats.totalRetrievals).toBe(5);
    expect(stats.discussionsRetrieved).toBe(3);
    expect(stats.top.map((stat) => [stat.title, stat.retrievalCount])).toEqual([
      ['Post b', 3],
      ['Post c', 1],
      ['Post a', 1],
    ]);
    expect(stats.top[0]).toMatchObject({
      discussionId: b.id,
      kind: 'post',
      url: 'https://test.invalid/post/b',
      lastRetrievedAt: '2026-01-15T12:02:00.000Z',
    });
  });

  it('limits the list but still totals everything', () => {
    const items = ['a', 'b', 'c'].map((name) => store(discussion(name)));
    recordRetrievals(db, items.map((item) => item.id), NOW);
    const stats = getRetrievalStats(db, 'games', 2);
    expect(stats.top).toHaveLength(2);
    expect(stats.totalRetrievals).toBe(3);
  });

  it('keeps communities separate', () => {
    const other = store(discussion('other', { community: 'movies' }));
    recordRetrievals(db, [other.id], NOW);
    expect(getRetrievalStats(db, 'games', 10).totalRetrievals).toBe(0);
    expect(getRetrievalStats(db, 'movies', 10).totalRetrievals).toBe(1);
  });
});

describe('listEmbeddings', () => {
  it('returns each embedding with its vector and retrieval count', () => {
    const a = store(discussion('a'), [0.25, -0.5, 1]);
    store(discussion('b'), [1, 0, 0]);
    recordRetrievals(db, [a.id, a.id], NOW);

    const embeddings = listEmbeddings(db, 'games', MODEL, WINDOW);
    expect(embeddings).toHaveLength(2);
    const first = embeddings.find((embedding) => embedding.discussionId === a.id);
    expect(first).toMatchObject({ kind: 'post', title: 'Post a', url: 'https://test.invalid/post/a', retrievalCount: 2 });
    expect([...(first?.vector ?? [])]).toEqual([0.25, -0.5, 1]);
    expect(embeddings.find((embedding) => embedding.discussionId !== a.id)?.retrievalCount).toBe(0);
  });

  it('leaves out discussions with no embedding, another model, outdated text, or an older date', () => {
    store(discussion('current'));
    store(discussion('unembedded'), null);
    store(discussion('other-model'), [1, 0], 'another-model');
    store(discussion('old', { postedAt: '2026-01-01T00:00:00.000Z' }));
    const edited = store(discussion('edited'));
    upsertDiscussions(db, [{ ...edited, body: 'Edited after embedding' }], NOW);

    expect(listEmbeddings(db, 'games', MODEL, WINDOW).map((embedding) => embedding.title)).toEqual(['Post current']);
  });
});
