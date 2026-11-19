import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EmbeddingError, type Embedder } from '../ollama/embeddings';
import { createKeywordEmbedder } from '../ollama/testSupport';
import type { Discussion } from '../shared/discussions';
import { SourceError, type DiscussionSource } from '../sources/discussionSource';
import { createFixtureSource, FIXTURE_COMMUNITY, FIXTURE_NOW } from '../sources/lemmy/fixtures/lemmyFixture';
import { openDatabase } from '../storage/database';
import { getDataStatus } from '../storage/discussionStore';
import { buildEmbeddingText, MAX_EMBEDDING_CHARACTERS, runIngestion } from './ingestService';

const KEYWORDS = ['delay', 'co-op', 'roguelike'];

let db: DatabaseSync;

beforeEach(() => {
  db = openDatabase(':memory:');
});

afterEach(() => {
  db.close();
});

function ingestFixture(embedder: Embedder, source: DiscussionSource = createFixtureSource().source) {
  return runIngestion({ db, source, embedder, community: FIXTURE_COMMUNITY, now: () => FIXTURE_NOW });
}

function countRows(table: 'discussions' | 'embeddings' | 'ingestion_runs'): number {
  return Number(db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get()?.total);
}

describe('runIngestion', () => {
  it('stores and embeds the past week from the source', async () => {
    const { embedder } = createKeywordEmbedder(KEYWORDS);
    const summary = await ingestFixture(embedder);
    expect(summary).toMatchObject({
      source: 'lemmy:lemmy.fixture.invalid',
      community: FIXTURE_COMMUNITY,
      windowStart: '2026-01-08T12:00:00.000Z',
      windowEnd: '2026-01-15T12:00:00.000Z',
      fetchedPosts: 3,
      fetchedComments: 3,
      inserted: 6,
      updated: 0,
      unchanged: 0,
      embedded: 6,
      pendingEmbeddings: 0,
      embeddingError: null,
    });
    expect(countRows('discussions')).toBe(6);
    expect(countRows('embeddings')).toBe(6);
  });

  it('adds no duplicates and embeds nothing when run again', async () => {
    const { embedder, calls } = createKeywordEmbedder(KEYWORDS);
    await ingestFixture(embedder);
    const second = await ingestFixture(embedder);
    expect(second).toMatchObject({ inserted: 0, updated: 0, unchanged: 6, embedded: 0, pendingEmbeddings: 0 });
    expect(countRows('discussions')).toBe(6);
    expect(countRows('embeddings')).toBe(6);
    expect(calls.documents).toHaveLength(1);
  });

  it('records each run so the last refresh time is known', async () => {
    const { embedder } = createKeywordEmbedder(KEYWORDS);
    await ingestFixture(embedder);
    expect(countRows('ingestion_runs')).toBe(1);
    expect(getDataStatus(db, FIXTURE_COMMUNITY, embedder.model)).toMatchObject({
      posts: 3,
      comments: 3,
      embedded: 6,
      lastIngestion: { finishedAt: '2026-01-15T12:00:00.000Z', inserted: 6 },
    });
  });

  it('keeps the fetched discussions when embedding fails, and embeds them on the next run', async () => {
    const broken: Embedder = {
      model: 'keyword-test-model',
      embedDocuments: async () => {
        throw new EmbeddingError('Ollama is not reachable at http://localhost:11434.');
      },
      embedQuery: async () => new Float32Array(),
    };
    const failed = await ingestFixture(broken);
    expect(failed).toMatchObject({ inserted: 6, embedded: 0, pendingEmbeddings: 6 });
    expect(failed.embeddingError).toContain('not reachable');
    expect(countRows('discussions')).toBe(6);

    const { embedder } = createKeywordEmbedder(KEYWORDS);
    const recovered = await ingestFixture(embedder);
    expect(recovered).toMatchObject({ unchanged: 6, embedded: 6, pendingEmbeddings: 0, embeddingError: null });
  });

  it('re-embeds everything when the embedding model changes', async () => {
    await ingestFixture(createKeywordEmbedder(KEYWORDS, 'model-a').embedder);
    const second = await ingestFixture(createKeywordEmbedder(KEYWORDS, 'model-b').embedder);
    expect(second).toMatchObject({ unchanged: 6, embedded: 6 });
    expect(countRows('embeddings')).toBe(6);
  });

  it('stores nothing and records no run when the source cannot be read', async () => {
    const offline: DiscussionSource = {
      name: 'offline',
      fetchDiscussions: async () => {
        throw new SourceError('Could not read /api/v3/post/list from lemmy.world: network error');
      },
    };
    const { embedder } = createKeywordEmbedder(KEYWORDS);
    await expect(ingestFixture(embedder, offline)).rejects.toBeInstanceOf(SourceError);
    expect(countRows('discussions')).toBe(0);
    expect(countRows('ingestion_runs')).toBe(0);
  });
});

describe('buildEmbeddingText', () => {
  const post: Discussion = {
    id: 'p',
    kind: 'post',
    community: 'games',
    postId: 'p',
    title: 'A title',
    body: 'A body',
    author: null,
    url: 'https://test.invalid/post/1',
    linkUrl: 'https://news.test.invalid/story',
    score: 1,
    postedAt: '2026-01-14T10:00:00.000Z',
  };

  it('combines a post title, body, and link', () => {
    expect(buildEmbeddingText(post)).toBe('A title\n\nA body\n\nLink: https://news.test.invalid/story');
  });

  it('leaves out empty parts', () => {
    expect(buildEmbeddingText({ ...post, body: '', linkUrl: null })).toBe('A title');
  });

  it('gives a comment its post title for context', () => {
    expect(buildEmbeddingText({ ...post, kind: 'comment', body: 'Agreed.' })).toBe('Comment on "A title":\n\nAgreed.');
  });

  it('caps very long text', () => {
    const long = buildEmbeddingText({ ...post, body: 'x'.repeat(MAX_EMBEDDING_CHARACTERS * 2) });
    expect(long).toHaveLength(MAX_EMBEDDING_CHARACTERS);
  });
});
