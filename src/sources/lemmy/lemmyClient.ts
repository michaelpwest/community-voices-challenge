import type { z } from 'zod';
import { SourceError } from '../discussionSource';
import {
  commentListSchema,
  postListSchema,
  type LemmyCommentView,
  type LemmyPostList,
} from './lemmySchemas';

export interface LemmyClientOptions {
  instanceUrl: string;
  userAgent: string;
  fetchFn?: typeof fetch;
  /** Injected in tests so they do not really wait. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Minimum gap between the start of consecutive requests. */
  minIntervalMs?: number;
  maxAttempts?: number;
  timeoutMs?: number;
}

export const POSTS_PER_PAGE = 50;
const MAX_RETRY_DELAY_MS = 30_000;

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A failed attempt. `retryable` separates transient trouble from a request that will never work. */
class AttemptError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
  }
}

function retryAfterMs(response: Response): number | null {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_RETRY_DELAY_MS) : null;
}

/** Read-only client for the two Lemmy endpoints this app uses. Requests run one at a time. */
export class LemmyClient {
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly minIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private lastRequestAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly options: LemmyClientOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleep = options.sleep ?? realSleep;
    this.now = options.now ?? Date.now;
    this.minIntervalMs = options.minIntervalMs ?? 300;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  /** One page of a community's posts, newest first. Pass the previous page's `next_page` to continue. */
  listPosts(community: string, pageCursor?: string): Promise<LemmyPostList> {
    const params = { community_name: community, sort: 'New', limit: String(POSTS_PER_PAGE), page_cursor: pageCursor };
    return this.getJson('/api/v3/post/list', params, postListSchema);
  }

  /** The highest-scored comments on a post, from any depth of the thread. */
  async listTopComments(postId: number, limit: number): Promise<LemmyCommentView[]> {
    const params = { post_id: String(postId), sort: 'Top', type_: 'All', limit: String(limit) };
    return (await this.getJson('/api/v3/comment/list', params, commentListSchema)).comments;
  }

  private async getJson<T>(path: string, params: Record<string, string | undefined>, schema: z.ZodType<T>): Promise<T> {
    const url = new URL(path, this.options.instanceUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    const host = url.host;

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.attempt(url, path, schema);
      } catch (error) {
        const failure = error instanceof AttemptError ? error : new AttemptError(String(error), false);
        if (!failure.retryable || attempt >= this.maxAttempts) {
          const tries = attempt > 1 ? ` after ${attempt} attempts` : '';
          throw new SourceError(`Could not read ${path} from ${host}${tries}: ${failure.message}`);
        }
        await this.sleep(failure.retryAfterMs ?? 1000 * 2 ** (attempt - 1));
      }
    }
  }

  private async attempt<T>(url: URL, path: string, schema: z.ZodType<T>): Promise<T> {
    await this.waitForTurn();
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        headers: { accept: 'application/json', 'user-agent': this.options.userAgent },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : '';
      throw new AttemptError(timedOut ? 'the request timed out' : `network error${cause}`, true);
    }

    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel();
      const reason = response.status === 429 ? 'rate limited (HTTP 429)' : `server error (HTTP ${response.status})`;
      throw new AttemptError(reason, true, retryAfterMs(response));
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200);
      throw new AttemptError(`HTTP ${response.status} ${detail}`.trim(), false);
    }

    const parsed = schema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) {
      throw new AttemptError(`unexpected response format for ${path}; the Lemmy API may have changed`, false);
    }
    return parsed.data;
  }

  /** Spaces requests out so the instance is never hit in a burst. */
  private async waitForTurn(): Promise<void> {
    const wait = this.lastRequestAt + this.minIntervalMs - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastRequestAt = this.now();
  }
}
