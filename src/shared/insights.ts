// Types for the embedding map and retrieval statistics, shared by the API and the web UI.
// Type-only imports keep this file usable by the browser build.

import type { DiscussionKind } from './discussions';

/** One stored discussion placed on the two-dimensional map of embeddings. */
export interface EmbeddingPoint {
  discussionId: string;
  kind: DiscussionKind;
  title: string;
  url: string;
  postedAt: string;
  /** Position on the map, each between -1 and 1. Nearby points have similar meaning. */
  x: number;
  y: number;
  /** How many times similarity search has returned this discussion. */
  retrievalCount: number;
}

/** The week's embeddings flattened from hundreds of dimensions to two. */
export interface EmbeddingMap {
  embeddingModel: string;
  /** Principal component analysis: the two directions along which the embeddings vary most. */
  method: 'pca';
  windowStart: string;
  windowEnd: string;
  /** Share of the embeddings' total variation that each axis keeps, from 0 to 1. */
  explainedVariance: [number, number];
  points: EmbeddingPoint[];
}

export interface RetrievalStat {
  discussionId: string;
  kind: DiscussionKind;
  title: string;
  url: string;
  postedAt: string;
  retrievalCount: number;
  lastRetrievedAt: string;
}

/** Which embeddings similarity search returns most often. */
export interface RetrievalStats {
  /** Every retrieval ever counted, across all discussions. */
  totalRetrievals: number;
  /** How many different discussions have been retrieved at least once. */
  discussionsRetrieved: number;
  /** The most-retrieved discussions, highest count first. */
  top: RetrievalStat[];
}
