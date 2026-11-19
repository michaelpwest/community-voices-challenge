import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { DataStatus, Discussion, IngestSummary, RetrievedDiscussion } from '../shared/discussions';
import type { TimeWindow } from '../shared/time';

export interface UpsertCounts {
  inserted: number;
  updated: number;
  unchanged: number;
}

/** A stored discussion whose embedding is missing or out of date. */
export interface PendingEmbedding {
  discussion: Discussion;
  contentHash: string;
}

export interface NewEmbedding {
  discussionId: string;
  model: string;
  contentHash: string;
  vector: Float32Array;
  createdAt: string;
}

export interface VectorSearch {
  vector: Float32Array;
  model: string;
  community: string;
  window: TimeWindow;
  limit: number;
}

const discussionRowSchema = z.object({
  id: z.string(),
  kind: z.enum(['post', 'comment']),
  community: z.string(),
  post_id: z.string(),
  title: z.string(),
  body: z.string(),
  author: z.string().nullable(),
  url: z.string(),
  link_url: z.string().nullable(),
  score: z.number(),
  posted_at: z.string(),
});

type DiscussionRow = z.infer<typeof discussionRowSchema>;

const DISCUSSION_COLUMNS = 'd.id, d.kind, d.community, d.post_id, d.title, d.body, d.author, d.url, d.link_url, d.score, d.posted_at';

function toDiscussion(row: DiscussionRow): Discussion {
  return {
    id: row.id,
    kind: row.kind,
    community: row.community,
    postId: row.post_id,
    title: row.title,
    body: row.body,
    author: row.author,
    url: row.url,
    linkUrl: row.link_url,
    score: row.score,
    postedAt: row.posted_at,
  };
}

/** Fingerprint of the text that gets embedded. Score changes do not alter it. */
export function contentHash(discussion: Pick<Discussion, 'title' | 'body' | 'linkUrl'>): string {
  return createHash('sha256')
    .update(JSON.stringify([discussion.title, discussion.body, discussion.linkUrl]))
    .digest('hex');
}

function toBlob(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
}

function inTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/**
 * Inserts new discussions and refreshes existing ones, matched by stable id, so
 * fetching the same item again never creates a second row.
 */
export function upsertDiscussions(db: DatabaseSync, discussions: Discussion[], fetchedAt: string): UpsertCounts {
  const findHash = db.prepare('SELECT content_hash FROM discussions WHERE id = ?');
  const upsert = db.prepare(`
    INSERT INTO discussions
      (id, kind, community, post_id, title, body, author, url, link_url, score, posted_at, fetched_at, content_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      title = excluded.title, body = excluded.body, author = excluded.author, url = excluded.url,
      link_url = excluded.link_url, score = excluded.score, posted_at = excluded.posted_at,
      fetched_at = excluded.fetched_at, content_hash = excluded.content_hash
  `);

  return inTransaction(db, () => {
    const counts: UpsertCounts = { inserted: 0, updated: 0, unchanged: 0 };
    for (const discussion of discussions) {
      const hash = contentHash(discussion);
      const existing = findHash.get(discussion.id);
      if (!existing) counts.inserted += 1;
      else if (existing.content_hash === hash) counts.unchanged += 1;
      else counts.updated += 1;
      upsert.run(
        discussion.id,
        discussion.kind,
        discussion.community,
        discussion.postId,
        discussion.title,
        discussion.body,
        discussion.author,
        discussion.url,
        discussion.linkUrl,
        discussion.score,
        discussion.postedAt,
        fetchedAt,
        hash,
      );
    }
    return counts;
  });
}

/** Discussions with no embedding, or one made from older text or by a different model. */
export function listPendingEmbeddings(db: DatabaseSync, model: string): PendingEmbedding[] {
  const rows = db
    .prepare(
      `SELECT ${DISCUSSION_COLUMNS}, d.content_hash
       FROM discussions d
       LEFT JOIN embeddings e ON e.discussion_id = d.id
       WHERE e.discussion_id IS NULL OR e.content_hash <> d.content_hash OR e.model <> ?
       ORDER BY d.posted_at DESC`,
    )
    .all(model);
  return rows.map((row) => ({
    discussion: toDiscussion(discussionRowSchema.parse(row)),
    contentHash: z.string().parse(row.content_hash),
  }));
}

export function saveEmbeddings(db: DatabaseSync, embeddings: NewEmbedding[]): void {
  const save = db.prepare(`
    INSERT INTO embeddings (discussion_id, model, content_hash, dimensions, vector, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (discussion_id) DO UPDATE SET
      model = excluded.model, content_hash = excluded.content_hash, dimensions = excluded.dimensions,
      vector = excluded.vector, created_at = excluded.created_at
  `);
  inTransaction(db, () => {
    for (const embedding of embeddings) {
      save.run(
        embedding.discussionId,
        embedding.model,
        embedding.contentHash,
        embedding.vector.length,
        toBlob(embedding.vector),
        embedding.createdAt,
      );
    }
  });
}

/**
 * The discussions closest to a query vector by cosine distance, limited to one
 * community and time window. This compares against every stored vector (an
 * exact search), which is fast at the size of one community's week.
 */
export function searchByVector(db: DatabaseSync, search: VectorSearch): RetrievedDiscussion[] {
  const rows = db
    .prepare(
      `SELECT ${DISCUSSION_COLUMNS}, vec_distance_cosine(e.vector, ?) AS distance
       FROM embeddings e
       JOIN discussions d ON d.id = e.discussion_id
       WHERE e.model = ? AND e.dimensions = ? AND e.content_hash = d.content_hash
         AND d.community = ? AND d.posted_at >= ? AND d.posted_at < ?
       ORDER BY distance ASC, d.id ASC
       LIMIT ?`,
    )
    .all(
      toBlob(search.vector),
      search.model,
      search.vector.length,
      search.community,
      search.window.start.toISOString(),
      search.window.end.toISOString(),
      search.limit,
    );
  return rows.map((row) => ({
    ...toDiscussion(discussionRowSchema.parse(row)),
    similarity: 1 - z.number().parse(row.distance),
  }));
}

function selectDiscussions(db: DatabaseSync, whereAndOrder: string, ...params: Array<string | number>): Discussion[] {
  const rows = db.prepare(`SELECT ${DISCUSSION_COLUMNS} FROM discussions d ${whereAndOrder}`).all(...params);
  return rows.map((row) => toDiscussion(discussionRowSchema.parse(row)));
}

/** Every stored discussion of a community posted inside the window, newest first. */
export function listDiscussionsInWindow(db: DatabaseSync, community: string, window: TimeWindow): Discussion[] {
  return selectDiscussions(
    db,
    'WHERE d.community = ? AND d.posted_at >= ? AND d.posted_at < ? ORDER BY d.posted_at DESC, d.id ASC',
    community,
    window.start.toISOString(),
    window.end.toISOString(),
  );
}

/** The highest-scored posts of a community inside the window. */
export function listTopPosts(db: DatabaseSync, community: string, window: TimeWindow, limit: number): Discussion[] {
  return selectDiscussions(
    db,
    `WHERE d.kind = 'post' AND d.community = ? AND d.posted_at >= ? AND d.posted_at < ?
     ORDER BY d.score DESC, d.id ASC LIMIT ?`,
    community,
    window.start.toISOString(),
    window.end.toISOString(),
    limit,
  );
}

/** The highest-scored stored comments on one post. */
export function listTopComments(db: DatabaseSync, postId: string, limit: number): Discussion[] {
  return selectDiscussions(
    db,
    `WHERE d.kind = 'comment' AND d.post_id = ? ORDER BY d.score DESC, d.id ASC LIMIT ?`,
    postId,
    limit,
  );
}

export function recordIngestionRun(db: DatabaseSync, summary: IngestSummary): void {
  db.prepare('INSERT INTO ingestion_runs (finished_at, summary) VALUES (?, ?)').run(
    summary.finishedAt,
    JSON.stringify(summary),
  );
}

export function getDataStatus(db: DatabaseSync, community: string, model: string): DataStatus {
  const counts = db
    .prepare(
      `SELECT
         COALESCE(SUM(d.kind = 'post'), 0) AS posts,
         COALESCE(SUM(d.kind = 'comment'), 0) AS comments,
         COALESCE(SUM(e.discussion_id IS NOT NULL), 0) AS embedded
       FROM discussions d
       LEFT JOIN embeddings e
         ON e.discussion_id = d.id AND e.content_hash = d.content_hash AND e.model = ?
       WHERE d.community = ?`,
    )
    .get(model, community);
  const lastRun = db.prepare('SELECT summary FROM ingestion_runs ORDER BY id DESC LIMIT 1').get();
  return {
    posts: Number(counts?.posts ?? 0),
    comments: Number(counts?.comments ?? 0),
    embedded: Number(counts?.embedded ?? 0),
    lastIngestion: typeof lastRun?.summary === 'string' ? (JSON.parse(lastRun.summary) as IngestSummary) : null,
  };
}
