import { describe, expect, it } from 'vitest';
import { SourceError } from '../discussionSource';
import { createFixtureFetch, FIXTURE_INSTANCE_URL, FIXTURE_USER_AGENT } from './fixtures/lemmyFixture';
import { LemmyClient } from './lemmyClient';

const EMPTY_POST_LIST = { posts: [] };

/** A client whose clock only moves when it "sleeps", so waits can be asserted exactly. */
function clientWith(fetchFn: typeof fetch) {
  let clock = 0;
  const sleeps: number[] = [];
  const client = new LemmyClient({
    instanceUrl: FIXTURE_INSTANCE_URL,
    userAgent: FIXTURE_USER_AGENT,
    fetchFn,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    minIntervalMs: 300,
  });
  return { client, sleeps };
}

/** Answers each request with the next queued response (or thrown error). */
function queuedFetch(queue: Array<Response | Error>) {
  let calls = 0;
  const fetchFn: typeof fetch = async () => {
    calls += 1;
    const next = queue.shift();
    if (!next) throw new Error('no more queued responses');
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchFn, calls: () => calls };
}

describe('LemmyClient', () => {
  it('requests the newest posts of the community with an identifying user-agent', async () => {
    const { fetchFn, requests } = createFixtureFetch();
    const { client } = clientWith(fetchFn);
    const list = await client.listPosts('fixture_games');
    expect(list.posts).toHaveLength(4);
    expect(list.next_page).toBe('Pfixture2');
    const request = requests[0];
    expect(request?.url.pathname).toBe('/api/v3/post/list');
    expect(Object.fromEntries(request?.url.searchParams ?? [])).toEqual({
      community_name: 'fixture_games',
      sort: 'New',
      limit: '50',
    });
    expect(request?.headers.get('user-agent')).toBe(FIXTURE_USER_AGENT);
  });

  it('asks for top-scored comments with the requested limit', async () => {
    const { fetchFn, requests } = createFixtureFetch();
    const { client } = clientWith(fetchFn);
    const comments = await client.listTopComments(1001, 7);
    expect(comments).toHaveLength(5);
    expect(Object.fromEntries(requests[0]?.url.searchParams ?? [])).toEqual({
      post_id: '1001',
      sort: 'Top',
      type_: 'All',
      limit: '7',
    });
  });

  it('waits between consecutive requests', async () => {
    const { fetchFn } = createFixtureFetch();
    const { client, sleeps } = clientWith(fetchFn);
    await client.listPosts('fixture_games');
    await client.listPosts('fixture_games', 'Pfixture2');
    await client.listTopComments(1001, 10);
    expect(sleeps).toEqual([300, 300]);
  });

  it('retries a server error and then succeeds', async () => {
    const { fetchFn, calls } = queuedFetch([new Response('busy', { status: 503 }), Response.json(EMPTY_POST_LIST)]);
    const { client, sleeps } = clientWith(fetchFn);
    await expect(client.listPosts('fixture_games')).resolves.toEqual(EMPTY_POST_LIST);
    expect(calls()).toBe(2);
    expect(sleeps).toContain(1000);
  });

  it('retries a network failure', async () => {
    const { fetchFn, calls } = queuedFetch([new TypeError('fetch failed'), Response.json(EMPTY_POST_LIST)]);
    const { client } = clientWith(fetchFn);
    await expect(client.listPosts('fixture_games')).resolves.toEqual(EMPTY_POST_LIST);
    expect(calls()).toBe(2);
  });

  it('honors Retry-After when rate limited', async () => {
    const limited = new Response('slow down', { status: 429, headers: { 'retry-after': '7' } });
    const { fetchFn } = queuedFetch([limited, Response.json(EMPTY_POST_LIST)]);
    const { client, sleeps } = clientWith(fetchFn);
    await client.listPosts('fixture_games');
    expect(sleeps).toContain(7000);
  });

  it('gives up after three attempts with a clear error', async () => {
    const { fetchFn, calls } = queuedFetch([
      new Response('', { status: 502 }),
      new Response('', { status: 502 }),
      new Response('', { status: 502 }),
    ]);
    const { client } = clientWith(fetchFn);
    const failure = client.listPosts('fixture_games');
    await expect(failure).rejects.toBeInstanceOf(SourceError);
    await expect(failure).rejects.toThrow(/lemmy\.fixture\.invalid after 3 attempts: server error \(HTTP 502\)/);
    expect(calls()).toBe(3);
  });

  it('does not retry a request the server rejects outright', async () => {
    const { fetchFn, calls } = queuedFetch([Response.json({ error: 'couldnt_find_community' }, { status: 404 })]);
    const { client } = clientWith(fetchFn);
    await expect(client.listPosts('no_such_community')).rejects.toThrow(/HTTP 404 .*couldnt_find_community/);
    expect(calls()).toBe(1);
  });

  it('reports a changed response format instead of returning bad data', async () => {
    const { fetchFn } = queuedFetch([Response.json({ posts: [{ post: { id: 'not-a-number' } }] })]);
    const { client } = clientWith(fetchFn);
    await expect(client.listPosts('fixture_games')).rejects.toThrow(/unexpected response format/);
  });

  it('reports a non-JSON reply as a format problem', async () => {
    const { fetchFn } = queuedFetch([new Response('<html>maintenance</html>')]);
    const { client } = clientWith(fetchFn);
    await expect(client.listPosts('fixture_games')).rejects.toThrow(/unexpected response format/);
  });
});
