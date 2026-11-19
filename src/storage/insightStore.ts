import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { DiscussionKind } from '../shared/discussions';
import type { RetrievalStats } from '../shared/insights';
import type { TimeWindow } from '../shared/time';

/** A stored embedding with the details needed to show it on the map. */
export interface StoredEmbedding {
  discussionId: string;
  kind: DiscussionKind;
  title: string;
  url: string;
  postedAt: string;
  vector: Float32Array;
  retrievalCount: number;
}

const kindSchema = z.enum(['post', 'comment']);

const embeddingRowSchema = z.object({
  id: z.string(),
  kind: kindSchema,
  title: z.string(),
  url: z.string(),
  posted_at: z.string(),
  vector: z.instanceof(Uint8Array),
  retrieval_count: z.number(),
});

const statRowSchema = z.object({
  id: z.string(),
  kind: kindSchema,
  title: z.string(),
  url: z.string(),
  posted_at: z.string(),
  retrieval_count: z.number(),
  last_retrieved_at: z.string(),
});

/** Copies the stored bytes, since a view into SQLite's buffer may not be aligned for 32-bit floats. */
function toVector(blob: Uint8Array): Float32Array {
  return new Float32Array(blob.slice().buffer);
}

/** Adds one to the retrieval count of each discussion that a similarity search just returned. */
export function recordRetrievals(db: DatabaseSync, discussionIds: string[], retrievedAt: string): void {
  const count = db.prepare(`
    INSERT INTO retrieval_stats (discussion_id, retrieval_count, last_retrieved_at)
    VALUES (?, 1, ?)
    ON CONFLICT (discussion_id) DO UPDATE SET
      retrieval_count = retrieval_count + 1, last_retrieved_at = excluded.last_retrieved_at
  `);
  for (const discussionId of discussionIds) count.run(discussionId, retrievedAt);
}

export function getRetrievalStats(db: DatabaseSync, community: string, limit: number): RetrievalStats {
  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(s.retrieval_count), 0) AS total, COUNT(*) AS discussions
       FROM retrieval_stats s JOIN discussions d ON d.id = s.discussion_id
       WHERE d.community = ?`,
    )
    .get(community);
  const rows = db
    .prepare(
      `SELECT d.id, d.kind, d.title, d.url, d.posted_at, s.retrieval_count, s.last_retrieved_at
       FROM retrieval_stats s JOIN discussions d ON d.id = s.discussion_id
       WHERE d.community = ?
       ORDER BY s.retrieval_count DESC, s.last_retrieved_at DESC, d.id ASC
       LIMIT ?`,
    )
    .all(community, limit);
  return {
    totalRetrievals: Number(totals?.total ?? 0),
    discussionsRetrieved: Number(totals?.discussions ?? 0),
    top: rows.map((row) => {
      const stat = statRowSchema.parse(row);
      return {
        discussionId: stat.id,
        kind: stat.kind,
        title: stat.title,
        url: stat.url,
        postedAt: stat.posted_at,
        retrievalCount: stat.retrieval_count,
        lastRetrievedAt: stat.last_retrieved_at,
      };
    }),
  };
}

/** Every current embedding of a community inside the window, with its retrieval count. */
export function listEmbeddings(db: DatabaseSync, community: string, model: string, window: TimeWindow): StoredEmbedding[] {
  const rows = db
    .prepare(
      `SELECT d.id, d.kind, d.title, d.url, d.posted_at, e.vector, COALESCE(s.retrieval_count, 0) AS retrieval_count
       FROM embeddings e
       JOIN discussions d ON d.id = e.discussion_id
       LEFT JOIN retrieval_stats s ON s.discussion_id = d.id
       WHERE e.model = ? AND e.content_hash = d.content_hash
         AND d.community = ? AND d.posted_at >= ? AND d.posted_at < ?
       ORDER BY d.posted_at DESC, d.id ASC`,
    )
    .all(model, community, window.start.toISOString(), window.end.toISOString());
  return rows.map((row) => {
    const embedding = embeddingRowSchema.parse(row);
    return {
      discussionId: embedding.id,
      kind: embedding.kind,
      title: embedding.title,
      url: embedding.url,
      postedAt: embedding.posted_at,
      vector: toVector(embedding.vector),
      retrievalCount: embedding.retrieval_count,
    };
  });
}
