import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runIngestion } from '../ingestion/ingestService';
import { createKeywordEmbedder } from '../ollama/testSupport';
import type { Discussion } from '../shared/discussions';
import { lastSevenDays } from '../shared/time';
import { createFixtureSource, FIXTURE_COMMUNITY, FIXTURE_NOW } from '../sources/lemmy/fixtures/lemmyFixture';
import { openDatabase } from '../storage/database';
import { contentHash, saveEmbeddings, upsertDiscussions } from '../storage/discussionStore';
import { EVIDENCE_LIMITS, EVIDENCE_QUERIES, selectEvidence } from './evidence';

const WINDOW = lastSevenDays(FIXTURE_NOW);
const { embedder, calls } = createKeywordEmbedder(['delay', 'co-op', 'roguelike', 'release', 'recommend']);
const shortId = (id: string): string => id.replace('lemmy:lemmy.fixture.invalid:', '');

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

const select = () => selectEvidence({ db, embedder, community: FIXTURE_COMMUNITY }, WINDOW);

describe('selectEvidence', () => {
  it('includes the week’s posts with their comments, grouped by post and labeled in order', async () => {
    const evidence = await select();
    expect(evidence.map((passage) => `${passage.label} ${shortId(passage.discussionId)}`)).toEqual([
      'S1 post:1001',
      'S2 comment:2001',
      'S3 comment:2002',
      'S4 post:1002',
      'S5 post:1004',
      'S6 comment:2010',
    ]);
  });

  it('gives every passage a source link, date, and the text shown to the model', async () => {
    const [first] = await select();
    expect(first).toMatchObject({
      kind: 'post',
      title: '[FIXTURE] Starfall Odyssey delayed to March',
      excerpt: 'The studio says it needs more time for polish.\n\nPre-orders stay valid.',
      url: 'https://lemmy.fixture.invalid/post/1001',
      postedAt: '2026-01-15T09:00:00.000Z',
      score: 120,
    });
  });

  it('records how each passage was selected', async () => {
    const evidence = await select();
    const topPost = evidence.find((passage) => shortId(passage.discussionId) === 'post:1001');
    expect(topPost?.selectedBy[0]).toEqual({ method: 'engagement', query: null, similarity: null });
    const bySimilarity = evidence.flatMap((passage) => passage.selectedBy).filter((by) => by.method === 'similarity');
    expect(bySimilarity.length).toBeGreaterThan(0);
    expect(bySimilarity.every((by) => by.query !== null && by.similarity !== null)).toBe(true);
  });

  it('runs one vector search per report query', async () => {
    calls.queries.length = 0;
    await select();
    expect(calls.queries).toEqual(EVIDENCE_QUERIES);
  });

  it('leaves out discussions from before the window', async () => {
    const old: Discussion = {
      id: 'lemmy:lemmy.fixture.invalid:post:old',
      kind: 'post',
      community: FIXTURE_COMMUNITY,
      postId: 'lemmy:lemmy.fixture.invalid:post:old',
      title: 'An old release with a huge score',
      body: 'release release release',
      author: null,
      url: 'https://lemmy.fixture.invalid/post/old',
      linkUrl: null,
      score: 9999,
      postedAt: '2025-12-01T00:00:00.000Z',
    };
    upsertDiscussions(db, [old], FIXTURE_NOW.toISOString());
    const [vector] = await embedder.embedDocuments([old.body]);
    saveEmbeddings(db, [
      {
        discussionId: old.id,
        model: embedder.model,
        contentHash: contentHash(old),
        vector: vector ?? new Float32Array(),
        createdAt: FIXTURE_NOW.toISOString(),
      },
    ]);
    const evidence = await select();
    expect(evidence.map((passage) => passage.discussionId)).not.toContain(old.id);
  });

  it('shortens long text and marks the cut', async () => {
    const long: Discussion = {
      id: 'lemmy:lemmy.fixture.invalid:post:long',
      kind: 'post',
      community: FIXTURE_COMMUNITY,
      postId: 'lemmy:lemmy.fixture.invalid:post:long',
      title: 'A very long post',
      body: 'word '.repeat(1000),
      author: null,
      url: 'https://lemmy.fixture.invalid/post/long',
      linkUrl: null,
      score: 500,
      postedAt: '2026-01-14T00:00:00.000Z',
    };
    upsertDiscussions(db, [long], FIXTURE_NOW.toISOString());
    const evidence = await select();
    const passage = evidence.find((item) => item.discussionId === long.id);
    expect(passage?.excerpt.endsWith(' [...]')).toBe(true);
    expect(passage?.excerpt.length).toBeLessThanOrEqual(EVIDENCE_LIMITS.postExcerptCharacters + 6);
  });

  it('stays within the passage and length limits when there is far more data', async () => {
    const many: Discussion[] = Array.from({ length: 200 }, (_, index) => ({
      id: `lemmy:lemmy.fixture.invalid:post:bulk-${index}`,
      kind: 'post',
      community: FIXTURE_COMMUNITY,
      postId: `lemmy:lemmy.fixture.invalid:post:bulk-${index}`,
      title: `Bulk post ${index}`,
      body: 'release '.repeat(400),
      author: null,
      url: `https://lemmy.fixture.invalid/post/bulk-${index}`,
      linkUrl: null,
      score: 1000 + index,
      postedAt: '2026-01-14T00:00:00.000Z',
    }));
    upsertDiscussions(db, many, FIXTURE_NOW.toISOString());
    const evidence = await select();
    const characters = evidence.reduce((total, passage) => total + passage.title.length + passage.excerpt.length, 0);
    expect(evidence.length).toBeLessThanOrEqual(EVIDENCE_LIMITS.maxPassages);
    expect(characters).toBeLessThanOrEqual(EVIDENCE_LIMITS.maxCharacters);
    // The highest-scored posts are kept first.
    expect(evidence[0]?.title).toBe('Bulk post 199');
  });
});
