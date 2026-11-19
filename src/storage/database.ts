import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as sqliteVec from 'sqlite-vec';
import type { DatabaseStatus } from '../shared/health';
import { initializeSchema } from './schema';

/** Opens (creating if needed) the SQLite file with sqlite-vec loaded and the tables in place. */
export function openDatabase(databasePath: string): DatabaseSync {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath, { allowExtension: true });
  try {
    sqliteVec.load(db);
    db.enableLoadExtension(false);
    initializeSchema(db);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

/** Confirms the database opens and sqlite-vec responds. Never throws. */
export function checkDatabase(databasePath: string): DatabaseStatus {
  try {
    const db = openDatabase(databasePath);
    try {
      const row = db.prepare('SELECT vec_version() AS version').get();
      const version = typeof row?.version === 'string' ? row.version : null;
      return { path: databasePath, ok: version !== null, vectorExtensionVersion: version, error: null };
    } finally {
      db.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { path: databasePath, ok: false, vectorExtensionVersion: null, error: message };
  }
}
