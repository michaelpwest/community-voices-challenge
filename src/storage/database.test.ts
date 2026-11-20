import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { checkDatabase, openDatabase } from './database';
import { SCHEMA_VERSION, SchemaVersionError } from './schema';

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'community-voices-db-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('openDatabase', () => {
  it('creates missing folders and loads sqlite-vec', () => {
    const db = openDatabase(join(workDir, 'nested', 'app.db'));
    try {
      const row = db.prepare('SELECT vec_distance_cosine(?, ?) AS distance').get('[1, 0]', '[0, 1]');
      expect(row?.distance).toBeCloseTo(1);
    } finally {
      db.close();
    }
  });
});

describe('schema version', () => {
  const versionOf = (path: string): number => {
    const db = new DatabaseSync(path);
    try {
      return Number(db.prepare('PRAGMA user_version').get()?.user_version);
    } finally {
      db.close();
    }
  };
  const setVersion = (path: string, version: number): void => {
    const db = new DatabaseSync(path);
    db.exec(`PRAGMA user_version = ${version}`);
    db.close();
  };

  it('is recorded in a new database file and accepted when reopened', () => {
    const path = join(workDir, 'app.db');
    openDatabase(path).close();
    expect(versionOf(path)).toBe(SCHEMA_VERSION);
    expect(() => openDatabase(path).close()).not.toThrow();
  });

  it('is added to a file made before versions were recorded', () => {
    const path = join(workDir, 'app.db');
    openDatabase(path).close();
    setVersion(path, 0);
    openDatabase(path).close();
    expect(versionOf(path)).toBe(SCHEMA_VERSION);
  });

  it('refuses a file from a different version and says how to recover', () => {
    const path = join(workDir, 'app.db');
    openDatabase(path).close();
    setVersion(path, SCHEMA_VERSION + 1);
    expect(() => openDatabase(path)).toThrow(SchemaVersionError);
    expect(() => openDatabase(path)).toThrow(/delete the "data" folder/);
    // The same message reaches the status page instead of crashing the health check.
    expect(checkDatabase(path)).toMatchObject({ ok: false, error: expect.stringContaining('different version') });
  });
});

describe('checkDatabase', () => {
  it('reports the sqlite-vec version for a usable database', () => {
    const status = checkDatabase(join(workDir, 'app.db'));
    expect(status.ok).toBe(true);
    expect(status.vectorExtensionVersion).toMatch(/^v\d+\.\d+/);
    expect(status.error).toBeNull();
  });

  it('reports an error instead of throwing when the path is unusable', () => {
    const blocker = join(workDir, 'not-a-folder');
    writeFileSync(blocker, 'x');
    const status = checkDatabase(join(blocker, 'app.db'));
    expect(status.ok).toBe(false);
    expect(status.error).toBeTruthy();
  });
});
