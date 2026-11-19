import type { DatabaseSync } from 'node:sqlite';

// Tables are created on first open. A fresh clone starts empty, and the
// launcher's "Clear data" removes the whole file, so there are no migrations.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS discussions (
    id            TEXT PRIMARY KEY,
    kind          TEXT NOT NULL CHECK (kind IN ('post', 'comment')),
    community     TEXT NOT NULL,
    post_id       TEXT NOT NULL,
    title         TEXT NOT NULL,
    body          TEXT NOT NULL,
    author        TEXT,
    url           TEXT NOT NULL,
    link_url      TEXT,
    score         INTEGER NOT NULL,
    posted_at     TEXT NOT NULL,  -- ISO 8601, UTC
    fetched_at    TEXT NOT NULL,  -- ISO 8601, UTC
    content_hash  TEXT NOT NULL   -- changes when the text changes
  );

  CREATE INDEX IF NOT EXISTS discussions_by_time ON discussions (community, posted_at);

  -- One embedding per discussion. content_hash records which text was embedded,
  -- so edited discussions are embedded again and unchanged ones are not.
  CREATE TABLE IF NOT EXISTS embeddings (
    discussion_id  TEXT PRIMARY KEY REFERENCES discussions (id) ON DELETE CASCADE,
    model          TEXT NOT NULL,
    content_hash   TEXT NOT NULL,
    dimensions     INTEGER NOT NULL,
    vector         BLOB NOT NULL,   -- float32 values, as sqlite-vec expects
    created_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ingestion_runs (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    finished_at  TEXT NOT NULL,
    summary   TEXT NOT NULL        -- the IngestSummary as JSON
  );
`;

export function initializeSchema(db: DatabaseSync): void {
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
}
