import { existsSync, rmSync } from 'node:fs';

// Kept separate from database.ts so the launcher can use it without loading node:sqlite.

const SIDE_FILE_SUFFIXES = ['', '-wal', '-shm', '-journal'];

/**
 * Deletes the SQLite file and its side files. Callers must obtain explicit
 * user confirmation first and make sure no process has the database open.
 * Returns the paths that were removed.
 */
export function deleteDatabaseFiles(databasePath: string): string[] {
  const removed: string[] = [];
  for (const suffix of SIDE_FILE_SUFFIXES) {
    const filePath = `${databasePath}${suffix}`;
    if (existsSync(filePath)) {
      rmSync(filePath);
      removed.push(filePath);
    }
  }
  return removed;
}
