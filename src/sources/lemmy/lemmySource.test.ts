import { describe, expect, it } from 'vitest';
import { lastSevenDays } from '../../shared/time';
import { createFixtureSource, FIXTURE_NOW } from './fixtures/lemmyFixture';

const WINDOW = lastSevenDays(FIXTURE_NOW);
const shortId = (id: string): string => id.replace('lemmy:lemmy.fixture.invalid:', '');

describe('LemmySource', () => {
  it('returns the posts inside the window with their top comments', async () => {
    const { source } = createFixtureSource();
    const discussions = await source.fetchDiscussions(WINDOW);
    expect(discussions.map((discussion) => shortId(discussion.id))).toEqual([
      'post:1001',
      'post:1002',
      'post:1004',
      'comment:2001',
      'comment:2002',
      'comment:2010',
    ]);
    expect(source.name).toBe('lemmy:lemmy.fixture.invalid');
  });

  it('keeps a post that appears on two pages only once', async () => {
    const { source } = createFixtureSource();
    const discussions = await source.fetchDiscussions(WINDOW);
    expect(discussions.filter((discussion) => shortId(discussion.id) === 'post:1001')).toHaveLength(1);
  });

  it('reads past an old pinned post but stops once ordinary posts are older than the window', async () => {
    const { source, requests } = createFixtureSource();
    await source.fetchDiscussions(WINDOW);
    const postRequests = requests.filter((request) => request.url.pathname === '/api/v3/post/list');
    // Page 1 starts with a pinned post from months ago; page 2 offers a cursor to page 3, which is never requested.
    expect(postRequests.map((request) => request.url.searchParams.get('page_cursor'))).toEqual([null, 'Pfixture2']);
  });

  it('requests comments only for in-window posts that have some', async () => {
    const { source, requests } = createFixtureSource(3);
    await source.fetchDiscussions(WINDOW);
    const commentRequests = requests.filter((request) => request.url.pathname === '/api/v3/comment/list');
    expect(commentRequests.map((request) => request.url.searchParams.get('post_id'))).toEqual(['1001', '1004']);
    expect(commentRequests.every((request) => request.url.searchParams.get('limit') === '3')).toBe(true);
  });

  it('fetches posts only when comments are turned off', async () => {
    const { source, requests } = createFixtureSource(0);
    const discussions = await source.fetchDiscussions(WINDOW);
    expect(discussions.every((discussion) => discussion.kind === 'post')).toBe(true);
    expect(requests).toHaveLength(2);
  });

  it('returns nothing when every post is older than the window', async () => {
    const { source } = createFixtureSource();
    const later = lastSevenDays(new Date('2027-01-01T00:00:00Z'));
    expect(await source.fetchDiscussions(later)).toEqual([]);
  });
});
