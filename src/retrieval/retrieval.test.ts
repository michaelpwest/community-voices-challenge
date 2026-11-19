import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runIngestion } from '../ingestion/ingestService';
import { createKeywordEmbedder } from '../ollama/testSupport';
import { createFixtureSource, FIXTURE_COMMUNITY, FIXTURE_NOW } from '../sources/lemmy/fixtures/lemmyFixture';
import { openDatabase } from '../storage/database';
import { retrieveDiscussions } from './retrieval';

// End to end over the synthetic fixture: fetch, normalize, store, embed, retrieve.

const { embedder, calls } = createKeywordEmbedder(['delay', 'co-op', 'roguelike']);
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

const retrieve = (query: string, topK: number, now = FIXTURE_NOW) =>
  retrieveDiscussions({ db, embedder, community: FIXTURE_COMMUNITY, now: () => now }, { query, topK });

describe('retrieveDiscussions', () => {
  it('returns the discussions closest in meaning to the query, with usable source links', async () => {
    const response = await retrieve('Which co-op games do people recommend?', 2);
    expect(response.results.map((result) => result.url).sort()).toEqual([
      'https://lemmy.fixture.invalid/comment/2010',
      'https://lemmy.fixture.invalid/post/1004',
    ]);
    expect(response.results.find((result) => result.kind === 'comment')).toMatchObject({
      author: 'fixture_user_five@third.fixture.invalid',
      postedAt: '2026-01-10T08:00:00.000Z',
      title: '[FIXTURE] What co-op games are you playing this weekend?',
    });
    expect(response.results.every((result) => result.similarity > 0.9)).toBe(true);
  });

  it('ranks a different topic for a different query', async () => {
    const response = await retrieve('Is the delay a good idea?', 3);
    expect(response.results.every((result) => result.postId === 'lemmy:lemmy.fixture.invalid:post:1001')).toBe(true);
  });

  it('describes the window and model that were used', async () => {
    const response = await retrieve('roguelike', 1);
    expect(response).toMatchObject({
      query: 'roguelike',
      windowStart: '2026-01-08T12:00:00.000Z',
      windowEnd: '2026-01-15T12:00:00.000Z',
      embeddingModel: 'keyword-test-model',
    });
    expect(calls.queries).toContain('roguelike');
  });

  it('returns nothing once the stored discussions are older than seven days', async () => {
    const response = await retrieve('co-op', 5, new Date('2026-02-15T12:00:00Z'));
    expect(response.results).toEqual([]);
  });

  it('respects the requested number of results', async () => {
    expect((await retrieve('delay', 1)).results).toHaveLength(1);
    expect((await retrieve('delay', 20)).results).toHaveLength(6);
  });
});
