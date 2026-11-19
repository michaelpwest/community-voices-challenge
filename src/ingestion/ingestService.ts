import type { DatabaseSync } from 'node:sqlite';
import { EmbeddingError, type Embedder } from '../ollama/embeddings';
import type { Discussion, IngestSummary } from '../shared/discussions';
import { lastSevenDays } from '../shared/time';
import type { DiscussionSource } from '../sources/discussionSource';
import {
  listPendingEmbeddings,
  recordIngestionRun,
  saveEmbeddings,
  upsertDiscussions,
  type PendingEmbedding,
} from '../storage/discussionStore';

export interface IngestDependencies {
  db: DatabaseSync;
  source: DiscussionSource;
  embedder: Embedder;
  community: string;
  now?: () => Date;
}

/**
 * Discussions are embedded whole, one vector each, because posts and comments
 * are short. Text beyond this length is left out of the embedding (the stored
 * body stays complete), which keeps even a very long post within the
 * embedding model's context.
 */
export const MAX_EMBEDDING_CHARACTERS = 6000;
const EMBEDDING_SAVE_BATCH = 32;

/** The text that represents a discussion in vector search. A comment carries its post's title for context. */
export function buildEmbeddingText(discussion: Discussion): string {
  const parts =
    discussion.kind === 'post'
      ? [discussion.title, discussion.body, discussion.linkUrl ? `Link: ${discussion.linkUrl}` : '']
      : [`Comment on "${discussion.title}":`, discussion.body];
  return parts.filter((part) => part !== '').join('\n\n').slice(0, MAX_EMBEDDING_CHARACTERS);
}

async function embedPending(
  db: DatabaseSync,
  embedder: Embedder,
  pending: PendingEmbedding[],
  now: () => Date,
): Promise<{ embedded: number; error: string | null }> {
  let embedded = 0;
  try {
    for (let start = 0; start < pending.length; start += EMBEDDING_SAVE_BATCH) {
      const batch = pending.slice(start, start + EMBEDDING_SAVE_BATCH);
      const vectors = await embedder.embedDocuments(batch.map((item) => buildEmbeddingText(item.discussion)));
      const createdAt = now().toISOString();
      saveEmbeddings(
        db,
        batch.flatMap((item, index) => {
          const vector = vectors[index];
          return vector
            ? [{ discussionId: item.discussion.id, model: embedder.model, contentHash: item.contentHash, vector, createdAt }]
            : [];
        }),
      );
      embedded += batch.length;
    }
    return { embedded, error: null };
  } catch (error) {
    // Stored discussions are kept; the next refresh embeds whatever is still pending.
    if (error instanceof EmbeddingError) return { embedded, error: error.message };
    throw error;
  }
}

/**
 * Fetches the past week from the source, stores it without duplicates, and
 * embeds anything new or changed. Throws SourceError when the source cannot be read.
 */
export async function runIngestion(dependencies: IngestDependencies): Promise<IngestSummary> {
  const { db, source, embedder, community, now = () => new Date() } = dependencies;
  const startedAt = now();
  const window = lastSevenDays(startedAt);

  const discussions = await source.fetchDiscussions(window);
  const counts = upsertDiscussions(db, discussions, now().toISOString());
  const embedding = await embedPending(db, embedder, listPendingEmbeddings(db, embedder.model), now);

  const summary: IngestSummary = {
    source: source.name,
    community,
    windowStart: window.start.toISOString(),
    windowEnd: window.end.toISOString(),
    startedAt: startedAt.toISOString(),
    finishedAt: now().toISOString(),
    fetchedPosts: discussions.filter((discussion) => discussion.kind === 'post').length,
    fetchedComments: discussions.filter((discussion) => discussion.kind === 'comment').length,
    ...counts,
    embedded: embedding.embedded,
    pendingEmbeddings: listPendingEmbeddings(db, embedder.model).length,
    embeddingError: embedding.error,
  };
  recordIngestionRun(db, summary);
  return summary;
}
