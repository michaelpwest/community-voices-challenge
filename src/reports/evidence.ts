import type { DatabaseSync } from 'node:sqlite';
import type { Embedder } from '../ollama/embeddings';
import { retrieveDiscussions } from '../retrieval/retrieval';
import type { Discussion } from '../shared/discussions';
import type { EvidencePassage, EvidenceSelection } from '../shared/reports';
import type { TimeWindow } from '../shared/time';
import { listTopComments, listTopPosts } from '../storage/discussionStore';

export interface EvidenceDependencies {
  db: DatabaseSync;
  embedder: Embedder;
  community: string;
}

/**
 * Retrieval queries, one per aspect a weekly report should cover. A single
 * query would return one topic; several broad ones pull in different threads.
 */
export const EVIDENCE_QUERIES = [
  'new releases, reviews, and announcements',
  'complaints, controversies, and criticism',
  'upcoming releases, events, and what people expect next',
  'industry and business news',
  'recommendations, questions, and what people are doing this week',
];

/** Bounds that keep the evidence well inside the model's context window. */
export const EVIDENCE_LIMITS = {
  topPosts: 8,
  commentsPerTopPost: 2,
  resultsPerQuery: 5,
  maxPassages: 50,
  maxCharacters: 24_000,
  postExcerptCharacters: 600,
  commentExcerptCharacters: 400,
};

interface Candidate {
  discussion: Discussion;
  selectedBy: EvidenceSelection[];
}

function excerpt(discussion: Discussion): string {
  const limit =
    discussion.kind === 'post' ? EVIDENCE_LIMITS.postExcerptCharacters : EVIDENCE_LIMITS.commentExcerptCharacters;
  return discussion.body.length > limit ? `${discussion.body.slice(0, limit).trimEnd()} [...]` : discussion.body;
}

/** Posts in the order first selected, each followed by its comments, highest score first. */
function groupByPost(candidates: Candidate[]): Candidate[] {
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.discussion.postId) ?? [];
    group.push(candidate);
    groups.set(candidate.discussion.postId, group);
  }
  return [...groups.values()].flatMap((group) =>
    group.sort(
      (a, b) =>
        Number(b.discussion.kind === 'post') - Number(a.discussion.kind === 'post') ||
        b.discussion.score - a.discussion.score,
    ),
  );
}

/**
 * Chooses the passages given to the RAG run, in two steps:
 *
 * 1. Engagement: the week's highest-scored posts and their top comments, so the
 *    biggest threads are always represented.
 * 2. Similarity: vector search for each query in EVIDENCE_QUERIES, which adds
 *    relevant discussions that did not score highly.
 *
 * Duplicates are merged, and the result is capped by passage count and total
 * length. Every passage records how it was selected.
 */
export async function selectEvidence(
  dependencies: EvidenceDependencies,
  window: TimeWindow,
): Promise<EvidencePassage[]> {
  const { db, embedder, community } = dependencies;
  const candidates = new Map<string, Candidate>();
  const add = (discussion: Discussion, selection: EvidenceSelection): void => {
    const existing = candidates.get(discussion.id);
    if (existing) existing.selectedBy.push(selection);
    else candidates.set(discussion.id, { discussion, selectedBy: [selection] });
  };

  const byEngagement: EvidenceSelection = { method: 'engagement', query: null, similarity: null };
  const topPosts = listTopPosts(db, community, window, EVIDENCE_LIMITS.topPosts);
  for (const post of topPosts) add(post, byEngagement);
  for (const post of topPosts) {
    for (const comment of listTopComments(db, post.id, EVIDENCE_LIMITS.commentsPerTopPost)) add(comment, byEngagement);
  }

  for (const query of EVIDENCE_QUERIES) {
    const { results } = await retrieveDiscussions(
      { db, embedder, community },
      { query, topK: EVIDENCE_LIMITS.resultsPerQuery, window },
    );
    for (const { similarity, ...discussion } of results) add(discussion, { method: 'similarity', query, similarity });
  }

  // Candidates are in priority order, so the caps drop the lowest-priority ones.
  const kept: Candidate[] = [];
  let characters = 0;
  for (const candidate of candidates.values()) {
    const size = candidate.discussion.title.length + excerpt(candidate.discussion).length;
    if (kept.length >= EVIDENCE_LIMITS.maxPassages || characters + size > EVIDENCE_LIMITS.maxCharacters) break;
    kept.push(candidate);
    characters += size;
  }

  return groupByPost(kept).map(({ discussion, selectedBy }, index) => ({
    label: `S${index + 1}`,
    discussionId: discussion.id,
    kind: discussion.kind,
    title: discussion.title,
    excerpt: excerpt(discussion),
    url: discussion.url,
    postedAt: discussion.postedAt,
    score: discussion.score,
    selectedBy,
  }));
}
