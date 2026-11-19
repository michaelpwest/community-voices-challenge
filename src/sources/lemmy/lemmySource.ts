import type { Discussion } from '../../shared/discussions';
import { parseUtcTimestamp, type TimeWindow } from '../../shared/time';
import type { DiscussionSource } from '../discussionSource';
import type { LemmyClient } from './lemmyClient';
import { normalizeComment, normalizePost, type LemmyContext } from './lemmyNormalize';

export interface LemmySourceOptions extends LemmyContext {
  /** How many of each post's highest-scored comments to keep. 0 keeps posts only. */
  commentsPerPost: number;
  /** Safety limit on post pages per fetch (50 posts each). */
  maxPages?: number;
}

interface PostInWindow {
  lemmyId: number;
  commentCount: number;
  discussion: Discussion;
}

/**
 * Reads one Lemmy community.
 *
 * Selection rules:
 * - Posts: every post published inside the window, walking the "New" listing
 *   page by page until a post older than the window appears.
 * - Comments: for each of those posts, only its `commentsPerPost`
 *   highest-scored comments (Lemmy's "Top" sort, any thread depth). This bounds
 *   both the request count (one per post) and the text later given to the LLM.
 * - Skipped: deleted or removed items, bot comments, and empty comments.
 * - Not covered: new comments on posts older than the window.
 */
export class LemmySource implements DiscussionSource {
  readonly name: string;
  private readonly maxPages: number;

  constructor(
    private readonly client: LemmyClient,
    private readonly options: LemmySourceOptions,
  ) {
    this.name = `lemmy:${new URL(options.instanceUrl).host}`;
    this.maxPages = options.maxPages ?? 20;
  }

  async fetchDiscussions(window: TimeWindow): Promise<Discussion[]> {
    const posts = await this.fetchPostsInWindow(window);
    // Keyed by id so an item seen twice (pages can shift while reading) is kept once.
    const discussions = new Map<string, Discussion>();
    for (const post of posts) discussions.set(post.discussion.id, post.discussion);

    if (this.options.commentsPerPost > 0) {
      for (const post of posts) {
        if (post.commentCount === 0) continue;
        const views = await this.client.listTopComments(post.lemmyId, this.options.commentsPerPost);
        for (const view of views) {
          const comment = normalizeComment(view, post.discussion, this.options);
          if (comment) discussions.set(comment.id, comment);
        }
      }
    }
    return [...discussions.values()];
  }

  private async fetchPostsInWindow(window: TimeWindow): Promise<PostInWindow[]> {
    const posts = new Map<number, PostInWindow>();
    let cursor: string | undefined;

    for (let page = 0; page < this.maxPages; page += 1) {
      const list = await this.client.listPosts(this.options.community, cursor);
      let reachedOlderPosts = false;

      for (const view of list.posts) {
        const publishedAt = parseUtcTimestamp(view.post.published);
        if (!publishedAt) continue;
        if (publishedAt < window.start) {
          // Pinned posts are listed first whatever their age, so they do not mark the end of the window.
          const pinned = view.post.featured_community || view.post.featured_local;
          if (!pinned) reachedOlderPosts = true;
          continue;
        }
        const discussion = normalizePost(view, this.options);
        if (discussion) {
          posts.set(view.post.id, { lemmyId: view.post.id, commentCount: view.counts.comments, discussion });
        }
      }

      cursor = list.next_page;
      if (reachedOlderPosts || !cursor || list.posts.length === 0) break;
    }
    return [...posts.values()];
  }
}
