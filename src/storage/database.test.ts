import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkDatabase, openDatabase } from './database';

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
