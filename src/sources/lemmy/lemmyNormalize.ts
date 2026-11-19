import type { Discussion } from '../../shared/discussions';
import { parseUtcTimestamp } from '../../shared/time';
import type { LemmyCommentView, LemmyPostView } from './lemmySchemas';

export interface LemmyContext {
  /** Instance the data was fetched from, without a trailing slash. */
  instanceUrl: string;
  community: string;
}

// Unicode control characters (Cc) and invisible formatting characters (Cf), such as zero-width spaces.
const INVISIBLE_CHARACTERS = /[\p{Cc}\p{Cf}]/gu;

/** Tidies user-written text without changing its meaning: one newline style, no invisible characters, no padding. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE_CHARACTERS, (character) => (character === '\t' || character === '\n' ? character : ''))
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stableId(context: LemmyContext, kind: 'post' | 'comment', id: number): string {
  return `lemmy:${new URL(context.instanceUrl).host}:${kind}:${id}`;
}

/** `name@home-instance`, so the same name on two instances stays distinct. */
function authorHandle(creator: { name: string; actor_id: string }): string {
  try {
    return `${creator.name}@${new URL(creator.actor_id).host}`;
  } catch {
    return creator.name;
  }
}

function httpUrlOrNull(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol) ? value : null;
  } catch {
    return null;
  }
}

/** Returns null for posts that should not be stored: deleted, removed, untitled, or undated. */
export function normalizePost(view: LemmyPostView, context: LemmyContext): Discussion | null {
  const { post, creator, counts } = view;
  const postedAt = parseUtcTimestamp(post.published);
  const title = normalizeText(post.name);
  if (post.deleted || post.removed || !postedAt || title === '') return null;
  const id = stableId(context, 'post', post.id);
  return {
    id,
    kind: 'post',
    community: context.community,
    postId: id,
    title,
    body: normalizeText(post.body ?? ''),
    author: authorHandle(creator),
    url: `${context.instanceUrl}/post/${post.id}`,
    linkUrl: httpUrlOrNull(post.url),
    score: counts.score,
    postedAt: postedAt.toISOString(),
  };
}

/** Returns null for comments that should not be stored: deleted, removed, written by a bot, empty, or undated. */
export function normalizeComment(view: LemmyCommentView, post: Discussion, context: LemmyContext): Discussion | null {
  const { comment, creator, counts } = view;
  const postedAt = parseUtcTimestamp(comment.published);
  const body = normalizeText(comment.content);
  if (comment.deleted || comment.removed || creator.bot_account || !postedAt || body === '') return null;
  return {
    id: stableId(context, 'comment', comment.id),
    kind: 'comment',
    community: context.community,
    postId: post.id,
    title: post.title,
    body,
    author: authorHandle(creator),
    url: `${context.instanceUrl}/comment/${comment.id}`,
    linkUrl: null,
    score: counts.score,
    postedAt: postedAt.toISOString(),
  };
}
