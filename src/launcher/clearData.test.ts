import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearDataWithConfirmation } from './clearData';

let workDir: string;
let databasePath: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'community-voices-clear-'));
  databasePath = join(workDir, 'app.db');
  writeFileSync(databasePath, 'data');
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function setup(answer: string) {
  const events: string[] = [];
  const io = {
    say: (line: string) => void events.push(`say: ${line}`),
    ask: async () => answer,
  };
  const dependencies = {
    databasePath,
    stopApi: async () => void events.push(`stop api (database exists: ${existsSync(databasePath)})`),
    startApi: async () => void events.push(`start api (database exists: ${existsSync(databasePath)})`),
  };
  return { events, run: () => clearDataWithConfirmation(io, dependencies) };
}

describe('clearDataWithConfirmation', () => {
  it.each(['', 'y', 'yes', 'delete', 'DELETE please'])('deletes nothing when the answer is "%s"', async (answer) => {
    const { events, run } = setup(answer);
    expect(await run()).toBe(false);
    expect(existsSync(databasePath)).toBe(true);
    expect(events.some((event) => event.startsWith('stop api'))).toBe(false);
    expect(events.at(-1)).toBe('say: Cancelled. Nothing was deleted.');
  });

  it('stops the API, deletes the database, then restarts the API when confirmed', async () => {
    const { events, run } = setup('DELETE');
    expect(await run()).toBe(true);
    expect(existsSync(databasePath)).toBe(false);
    expect(events.filter((event) => !event.startsWith('say'))).toEqual([
      'stop api (database exists: true)',
      'start api (database exists: false)',
    ]);
  });
});
