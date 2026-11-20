import type { DatabaseSync } from 'node:sqlite';

// Tables are created on first open and there are no migrations. "Clear data"
// empties the tables but keeps the file, so the file records which version of
// these definitions it was made with. Raise SCHEMA_VERSION whenever a table
// definition changes; an older file is then refused with instructions instead
// of being used with the wrong shape.
export const SCHEMA_VERSION = 1;

/** The database file was made by a version of this app with different tables. */
export class SchemaVersionError extends Error {
  constructor(found: number) {
    super(
      `The database was created by a different version of this app (schema ${found}, expected ${SCHEMA_VERSION}). ` +
        'Stop the app and delete the "data" folder to start fresh.',
    );
    this.name = 'SchemaVersionError';
  }
}

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

  -- How often similarity search has returned each discussion's embedding.
  CREATE TABLE IF NOT EXISTS retrieval_stats (
    discussion_id      TEXT PRIMARY KEY REFERENCES discussions (id) ON DELETE CASCADE,
    retrieval_count    INTEGER NOT NULL,
    last_retrieved_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ingestion_runs (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    finished_at  TEXT NOT NULL,
    summary   TEXT NOT NULL        -- the IngestSummary as JSON
  );

  -- One row per baseline-versus-RAG generation: both reports, the evidence
  -- given to the RAG run, the settings shared by both, and the comparison.
  CREATE TABLE IF NOT EXISTS report_runs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    community     TEXT NOT NULL,
    generated_at  TEXT NOT NULL,
    payload       TEXT NOT NULL    -- the ReportRun (without its id) as JSON
  );
`;

/** Creates the tables in a new file, or confirms an existing file has the expected version. */
export function initializeSchema(db: DatabaseSync): void {
  db.exec('PRAGMA foreign_keys = ON');
  // 0 means a new file, or one made before versions were recorded (same tables as version 1).
  const found = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
  if (found !== 0 && found !== SCHEMA_VERSION) throw new SchemaVersionError(found);
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}
