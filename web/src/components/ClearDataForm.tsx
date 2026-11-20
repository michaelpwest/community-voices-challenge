import { useState, type FormEvent } from 'react';
import { CLEAR_CONFIRMATION } from '../../../src/shared/discussions';
import { Button } from './ui';

interface ClearDataFormProps {
  /** What will be deleted, in words, e.g. "390 posts and comments and 2 reports". */
  whatWillBeDeleted: string;
  deleting: boolean;
  onConfirm: (confirmation: string) => void;
  onCancel: () => void;
}

/**
 * Asks the user to type the confirmation word before anything is deleted.
 * The delete button stays disabled until the word matches exactly.
 */
export function ClearDataForm({ whatWillBeDeleted, deleting, onConfirm, onCancel }: ClearDataFormProps) {
  const [typed, setTyped] = useState('');
  const confirmed = typed === CLEAR_CONFIRMATION;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (confirmed && !deleting) onConfirm(typed);
  };

  return (
    <form onSubmit={submit} aria-label="Confirm clearing data" className="mt-3 rounded-md border border-problem p-3">
      <p>
        <strong>Delete all stored data?</strong> This removes {whatWillBeDeleted}, along with the embeddings and
        retrieval counts. It cannot be undone, but you can refresh the feed and generate reports again.
      </p>
      <label className="mt-3 block text-sm">
        Type {CLEAR_CONFIRMATION} to confirm
        <input
          type="text"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          autoFocus
          className="mt-1 block min-h-11 w-full max-w-xs rounded-md border border-line bg-surface px-3"
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-2.5">
        <Button type="submit" danger disabled={!confirmed || deleting}>
          {deleting ? 'Deleting…' : 'Delete everything'}
        </Button>
        <Button onClick={onCancel} disabled={deleting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
