import type { DatabaseSync } from 'node:sqlite';
import type { ReportRun } from '../shared/reports';

export type NewReportRun = Omit<ReportRun, 'id'>;

/** Stores a finished run and returns it with its assigned id. */
export function saveReportRun(db: DatabaseSync, run: NewReportRun): ReportRun {
  const result = db
    .prepare('INSERT INTO report_runs (community, generated_at, payload) VALUES (?, ?, ?)')
    .run(run.community, run.generatedAt, JSON.stringify(run));
  return { ...run, id: Number(result.lastInsertRowid) };
}

export function getLatestReportRun(db: DatabaseSync, community: string): ReportRun | null {
  const row = db
    .prepare('SELECT id, payload FROM report_runs WHERE community = ? ORDER BY id DESC LIMIT 1')
    .get(community);
  if (!row || typeof row.payload !== 'string') return null;
  return { ...(JSON.parse(row.payload) as NewReportRun), id: Number(row.id) };
}
