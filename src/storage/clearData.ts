import type { DatabaseSync } from 'node:sqlite';
import type { ClearSummary } from '../shared/discussions';

/**
 * Deletes every stored discussion, embedding, retrieval count, ingestion
 * record, and report. All of it goes or none of it does. Callers must obtain
 * explicit confirmation first; the data cannot be recovered afterwards except
 * by refreshing the feed and generating reports again.
 */
export function clearAllData(db: DatabaseSync): ClearSummary {
  const count = (table: 'discussions' | 'report_runs'): number =>
    Number(db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get()?.total ?? 0);
  const summary: ClearSummary = { discussions: count('discussions'), reports: count('report_runs') };

  db.exec('BEGIN');
  try {
    // Children first, so this works whether or not foreign-key cascades are on.
    for (const table of ['retrieval_stats', 'embeddings', 'discussions', 'ingestion_runs', 'report_runs']) {
      db.exec(`DELETE FROM ${table}`);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  // Returns the freed space to the file system.
  db.exec('VACUUM');
  return summary;
}
