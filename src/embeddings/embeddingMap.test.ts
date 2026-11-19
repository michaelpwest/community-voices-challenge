import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runIngestion } from '../ingestion/ingestService';
import { createKeywordEmbedder } from '../ollama/testSupport';
import { retrieveDiscussions } from '../retrieval/retrieval';
import { createFixtureSource, FIXTURE_COMMUNITY, FIXTURE_NOW } from '../sources/lemmy/fixtures/lemmyFixture';
import { openDatabase } from '../storage/database';
import { getRetrievalStats } from '../storage/insightStore';
import { buildEmbeddingMap } from './embeddingMap';

// Over the synthetic fixture: ingest, embed, retrieve, then map and count.

const { embedder } = createKeywordEmbedder(['delay', 'co-op', 'roguelike']);
let db: DatabaseSync;

beforeEach(async () => {
  db = openDatabase(':memory:');
  await runIngestion({
    db,
    source: createFixtureSource().source,
    embedder,
    community: FIXTURE_COMMUNITY,
    now: () => FIXTURE_NOW,
  });
});

afterEach(() => {
  db.close();
});

const buildMap = (now = FIXTURE_NOW) =>
  buildEmbeddingMap({ db, community: FIXTURE_COMMUNITY, embeddingModel: embedder.model, now: () => now });

const search = (query: string, topK: number) =>
  retrieveDiscussions({ db, embedder, community: FIXTURE_COMMUNITY, now: () => FIXTURE_NOW }, { query, topK });

describe('buildEmbeddingMap', () => {
  it('places every embedded discussion from the past week on the map', () => {
    const map = buildMap();
    expect(map).toMatchObject({
      embeddingModel: 'keyword-test-model',
      method: 'pca',
      windowStart: '2026-01-08T12:00:00.000Z',
      windowEnd: '2026-01-15T12:00:00.000Z',
    });
    expect(map.points).toHaveLength(6);
    expect(map.points.every((point) => Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1)).toBe(true);
    expect(map.points.find((point) => point.url.endsWith('/post/1004'))).toMatchObject({
      kind: 'post',
      title: '[FIXTURE] What co-op games are you playing this weekend?',
      postedAt: '2026-01-10T07:15:00.123Z',
      retrievalCount: 0,
    });
  });

  it('puts discussions about the same topic closer together than unrelated ones', () => {
    const { points } = buildMap();
    const at = (path: string) => points.find((point) => point.url.endsWith(path)) ?? { x: NaN, y: NaN };
    const distance = (a: string, b: string): number => Math.hypot(at(a).x - at(b).x, at(a).y - at(b).y);
    // Post 1001 and comment 2001 are both about the delay; post 1004 is about co-op games.
    expect(distance('/post/1001', '/comment/2001')).toBeLessThan(distance('/post/1001', '/post/1004'));
    // Post 1004 and comment 2010 are both about co-op games.
    expect(distance('/post/1004', '/comment/2010')).toBeLessThan(distance('/comment/2010', '/comment/2001'));
  });

  it('is empty once the stored discussions are older than seven days', () => {
    expect(buildMap(new Date('2026-03-01T00:00:00Z')).points).toEqual([]);
  });
});

describe('retrieval counting', () => {
  it('counts a discussion each time similarity search returns it', async () => {
    await search('co-op games', 2);
    await search('more co-op', 1);
    const stats = getRetrievalStats(db, FIXTURE_COMMUNITY, 10);
    expect(stats.totalRetrievals).toBe(3);
    expect(stats.discussionsRetrieved).toBe(2);
    expect(stats.top[0]?.retrievalCount).toBe(2);
    expect(stats.top.every((stat) => stat.title.includes('co-op'))).toBe(true);
  });

  it('shows the counts on the map', async () => {
    await search('roguelike', 1);
    const counted = buildMap().points.filter((point) => point.retrievalCount > 0);
    expect(counted).toHaveLength(1);
    expect(counted[0]?.title).toContain('roguelike');
  });

  it('counts nothing when a search finds nothing', async () => {
    await retrieveDiscussions(
      { db, embedder, community: FIXTURE_COMMUNITY, now: () => new Date('2026-03-01T00:00:00Z') },
      { query: 'co-op', topK: 5 },
    );
    expect(getRetrievalStats(db, FIXTURE_COMMUNITY, 10).totalRetrievals).toBe(0);
  });
});
