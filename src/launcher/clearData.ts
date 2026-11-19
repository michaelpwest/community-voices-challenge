import { deleteDatabaseFiles } from '../storage/databaseFiles';
import type { SetupIo } from './ollamaSetup';

export const CLEAR_CONFIRMATION = 'DELETE';

export interface ClearDataDependencies {
  databasePath: string;
  stopApi: () => Promise<void>;
  startApi: () => Promise<void>;
}

/**
 * Deletes the local database only after the user types the confirmation word.
 * The API keeps the database open, so it is stopped while the files are
 * removed and restarted afterwards. Returns true when data was cleared.
 */
export async function clearDataWithConfirmation(
  io: Pick<SetupIo, 'say' | 'ask'>,
  { databasePath, stopApi, startApi }: ClearDataDependencies,
): Promise<boolean> {
  io.say(`This permanently deletes all ingested data and reports in ${databasePath}.`);
  const answer = await io.ask(`Type ${CLEAR_CONFIRMATION} to confirm, or press Enter to cancel: `);
  if (answer.trim() !== CLEAR_CONFIRMATION) {
    io.say('Cancelled. Nothing was deleted.');
    return false;
  }
  await stopApi();
  try {
    const removed = deleteDatabaseFiles(databasePath);
    io.say(removed.length > 0 ? `Deleted: ${removed.join(', ')}` : 'No database file existed; nothing to delete.');
  } finally {
    await startApi();
  }
  return true;
}
