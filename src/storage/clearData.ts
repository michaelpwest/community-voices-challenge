import type { DatabaseSync } from 'node:sqlite';
import type { ClearSummary } from '../shared/discussions';

/**
 * Shrinks the file after a clear. The data is already gone by this point, so a
 * failure here (a full disk, or another program reading the file) must not
 * make the clear look like it failed.
 */
function reclaimSpace(db: DatabaseSync): void {
  try {
    db.exec('VACUUM');
  } catch (error) {
    console.warn('Data was cleared, but the database file could not be shrunk:', error);
  }
}

/**
 * Deletes every stored discussion, embedding, retrieval count, ingestion
 * record, and report, for every community. All of it goes or none of it does. Callers must obtain
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
  reclaimSpace(db);
  return summary;
}
