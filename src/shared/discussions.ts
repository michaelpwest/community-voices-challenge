// Types shared by the API, the launcher, and the web UI. Keep this file free of imports.

export type DiscussionKind = 'post' | 'comment';

/** A community post or comment after normalization. Timestamps are ISO 8601 in UTC. */
export interface Discussion {
  /** Stable across fetches, e.g. `lemmy:lemmy.world:post:123`. */
  id: string;
  kind: DiscussionKind;
  community: string;
  /** The id of the post this belongs to (its own id for a post). */
  postId: string;
  /** The post title; for a comment, the title of the post it replies under. */
  title: string;
  body: string;
  author: string | null;
  /** Where to read this discussion on the source site. */
  url: string;
  /** The external article a post links to, if any. */
  linkUrl: string | null;
  score: number;
  postedAt: string;
}

export interface RetrievedDiscussion extends Discussion {
  /** Cosine similarity to the query, from -1 to 1; higher is closer. */
  similarity: number;
}

export interface SearchResponse {
  query: string;
  windowStart: string;
  windowEnd: string;
  embeddingModel: string;
  results: RetrievedDiscussion[];
}

export interface IngestSummary {
  source: string;
  community: string;
  windowStart: string;
  windowEnd: string;
  startedAt: string;
  finishedAt: string;
  fetchedPosts: number;
  fetchedComments: number;
  inserted: number;
  updated: number;
  unchanged: number;
  embedded: number;
  /** Stored discussions that still have no current embedding. */
  pendingEmbeddings: number;
  /** Set when discussions were stored but embedding could not finish. */
  embeddingError: string | null;
}

export interface DataStatus {
  posts: number;
  comments: number;
  embedded: number;
  lastIngestion: IngestSummary | null;
}
