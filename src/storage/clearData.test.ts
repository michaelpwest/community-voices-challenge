import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runIngestion } from '../ingestion/ingestService';
import { createKeywordEmbedder, createScriptedGenerator } from '../ollama/testSupport';
import { generateReportRun } from '../reports/reportService';
import { report } from '../reports/testSupport';
import { retrieveDiscussions } from '../retrieval/retrieval';
import { createFixtureSource, FIXTURE_COMMUNITY, FIXTURE_NOW } from '../sources/lemmy/fixtures/lemmyFixture';
import { clearAllData } from './clearData';
import { openDatabase } from './database';
import { getDataStatus } from './discussionStore';
import { getRetrievalStats } from './insightStore';
import { getLatestReportRun } from './reportStore';

const TABLES = ['discussions', 'embeddings', 'retrieval_stats', 'ingestion_runs', 'report_runs'] as const;
const { embedder } = createKeywordEmbedder(['delay', 'co-op', 'roguelike']);
const now = (): Date => FIXTURE_NOW;

let db: DatabaseSync;

const rowCounts = (): number[] =>
  TABLES.map((table) => Number(db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get()?.total));

/** Fills every table the way real use does: a refresh, a search, and a report run. */
async function fillWithData(): Promise<void> {
  await runIngestion({ db, source: createFixtureSource().source, embedder, community: FIXTURE_COMMUNITY, now });
  await retrieveDiscussions({ db, embedder, community: FIXTURE_COMMUNITY, now }, { query: 'co-op', topK: 2 });
  await generateReportRun({
    db,
    embedder,
    generator: createScriptedGenerator(() => JSON.stringify(report())).generator,
    community: FIXTURE_COMMUNITY,
    communityUrl: 'https://lemmy.fixture.invalid/c/fixture_games',
    numCtx: 16384,
    now,
  });
}

beforeEach(() => {
  db = openDatabase(':memory:');
});

afterEach(() => {
  db.close();
});

describe('clearAllData', () => {
  it('empties every table and reports what was removed', async () => {
    await fillWithData();
    expect(rowCounts().every((count) => count > 0)).toBe(true);

    expect(clearAllData(db)).toEqual({ discussions: 6, reports: 1 });
    expect(rowCounts()).toEqual([0, 0, 0, 0, 0]);
  });

  it('leaves the app in its fresh-install state', async () => {
    await fillWithData();
    clearAllData(db);
    expect(getDataStatus(db, FIXTURE_COMMUNITY, embedder.model)).toEqual({
      posts: 0,
      comments: 0,
      embedded: 0,
      lastIngestion: null,
    });
    expect(getLatestReportRun(db, FIXTURE_COMMUNITY)).toBeNull();
    expect(getRetrievalStats(db, FIXTURE_COMMUNITY, 10).totalRetrievals).toBe(0);
  });

  it('allows a new refresh afterwards', async () => {
    await fillWithData();
    clearAllData(db);
    const summary = await runIngestion({
      db,
      source: createFixtureSource().source,
      embedder,
      community: FIXTURE_COMMUNITY,
      now,
    });
    expect(summary).toMatchObject({ inserted: 6, embedded: 6 });
  });

  it('does nothing harmful on an empty database', () => {
    expect(clearAllData(db)).toEqual({ discussions: 0, reports: 0 });
  });
});
