import type { Discussion } from '../shared/discussions';
import type { TimeWindow } from '../shared/time';

/** A community feed that can return the discussions posted in a time window. */
export interface DiscussionSource {
  /** Short label recorded with each ingestion run, e.g. `lemmy:lemmy.world`. */
  readonly name: string;
  fetchDiscussions(window: TimeWindow): Promise<Discussion[]>;
}

/** The source could not be read: it is unreachable, refused the request, or changed its format. */
export class SourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceError';
  }
}
