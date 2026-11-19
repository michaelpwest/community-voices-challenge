import type { DatabaseSync } from 'node:sqlite';
import type { Embedder } from '../ollama/embeddings';
import type { SearchResponse } from '../shared/discussions';
import { lastSevenDays, type TimeWindow } from '../shared/time';
import { searchByVector } from '../storage/discussionStore';
import { recordRetrievals } from '../storage/insightStore';

export interface RetrievalDependencies {
  db: DatabaseSync;
  embedder: Embedder;
  community: string;
  now?: () => Date;
}

export interface RetrievalRequest {
  query: string;
  topK: number;
  /** Defaults to the past seven days. */
  window?: TimeWindow;
}

export const DEFAULT_TOP_K = 5;
export const MAX_TOP_K = 20;

/**
 * Finds the stored discussions most similar in meaning to the query, restricted
 * to the time window. Each result carries its source URL and posted time, and
 * each result's retrieval count goes up by one.
 * Throws EmbeddingError when the query cannot be embedded.
 */
export async function retrieveDiscussions(
  dependencies: RetrievalDependencies,
  request: RetrievalRequest,
): Promise<SearchResponse> {
  const { db, embedder, community, now = () => new Date() } = dependencies;
  const window = request.window ?? lastSevenDays(now());
  const vector = await embedder.embedQuery(request.query);
  const results = searchByVector(db, { vector, model: embedder.model, community, window, limit: request.topK });
  recordRetrievals(
    db,
    results.map((result) => result.id),
    now().toISOString(),
  );
  return {
    query: request.query,
    windowStart: window.start.toISOString(),
    windowEnd: window.end.toISOString(),
    embeddingModel: embedder.model,
    results,
  };
}
