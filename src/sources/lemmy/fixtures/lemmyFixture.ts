import { readFileSync } from 'node:fs';
import { LemmyClient } from '../lemmyClient';
import { LemmySource } from '../lemmySource';

// Test support only: serves the synthetic fixture files in place of a Lemmy
// instance. See README.md in this folder. Never import this from app code.

export const FIXTURE_INSTANCE_URL = 'https://lemmy.fixture.invalid';
export const FIXTURE_COMMUNITY = 'fixture_games';
export const FIXTURE_USER_AGENT = 'community-voices-tests/0.0';
/** The moment the fixture's dates are written around. */
export const FIXTURE_NOW = new Date('2026-01-15T12:00:00Z');

export function readFixture(fileName: string): unknown {
  return JSON.parse(readFileSync(new URL(`./${fileName}`, import.meta.url), 'utf8'));
}

function fixtureFileFor(url: URL): string | null {
  if (url.pathname === '/api/v3/post/list') {
    const cursor = url.searchParams.get('page_cursor');
    if (cursor === null) return 'post-list-page-1.json';
    if (cursor === 'Pfixture2') return 'post-list-page-2.json';
  }
  if (url.pathname === '/api/v3/comment/list') {
    return `comment-list-post-${url.searchParams.get('post_id')}.json`;
  }
  return null;
}

/** A stand-in for fetch that answers from the fixture files and records each request. */
export function createFixtureFetch() {
  const requests: Array<{ url: URL; headers: Headers }> = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, headers: new Headers(init?.headers) });
    const fileName = fixtureFileFor(url);
    try {
      if (fileName) return Response.json(readFixture(fileName));
    } catch {
      // No fixture file for this request.
    }
    return Response.json({ error: 'fixture_not_found' }, { status: 404 });
  };
  return { fetchFn, requests };
}

/** A LemmySource wired to the fixture, with no real waiting between requests. */
export function createFixtureSource(commentsPerPost = 10) {
  const { fetchFn, requests } = createFixtureFetch();
  const client = new LemmyClient({
    instanceUrl: FIXTURE_INSTANCE_URL,
    userAgent: FIXTURE_USER_AGENT,
    fetchFn,
    sleep: async () => undefined,
  });
  const source = new LemmySource(client, {
    instanceUrl: FIXTURE_INSTANCE_URL,
    community: FIXTURE_COMMUNITY,
    commentsPerPost,
  });
  return { source, requests };
}
