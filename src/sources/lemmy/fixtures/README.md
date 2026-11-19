# Lemmy test fixture (synthetic)

**This is made-up sample data for automated tests. It is not real community activity.**

- Every post, comment, user, and URL here was written by hand. Nothing was copied from lemmy.world or any other site.
- The files follow the response shape of Lemmy's v3 API (`/api/v3/post/list` and `/api/v3/comment/list`, checked against Lemmy 0.19), so tests exercise the same parsing and normalization code as live ingestion.
- Titles start with `[FIXTURE]` and hosts end in `.invalid` so the data cannot be mistaken for the real thing.
- Only tests read these files (through `lemmyFixture.ts`). The app never loads them into its database (decision D-004).

The fixture assumes the current time is `2026-01-15T12:00:00Z`, which makes the reporting window start at `2026-01-08T12:00:00Z`.

| File | Stands in for | What it covers |
| --- | --- | --- |
| `post-list-page-1.json` | First page of posts | An old pinned post, a post with comments, a link-only post, a deleted post, and a cursor to page 2 |
| `post-list-page-2.json` | Second page of posts | A post repeated from page 1, a timestamp without a time zone, and posts older than the window |
| `comment-list-post-1001.json` | Top comments on post 1001 | A normal comment, a prompt-injection attempt, and removed, bot, and blank comments |
| `comment-list-post-1004.json` | Top comments on post 1004 | A comment from another instance and a deleted comment |

Keep it small. If Lemmy's response shape changes, update these files together with `lemmySchemas.ts`.
