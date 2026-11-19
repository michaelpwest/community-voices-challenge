import type { DataStatus, IngestSummary } from '../shared/discussions';
import type { HealthResponse, OllamaStatus } from '../shared/health';
import { plainPalette, type Palette } from './palette';

export function formatOllama(ollama: OllamaStatus, paint: Palette = plainPalette): string[] {
  if (!ollama.reachable) {
    return [`Ollama:    ${paint.problem('NOT REACHABLE')} at ${ollama.url} (${ollama.error ?? 'unknown error'})`];
  }
  const models = ollama.models.map((model) =>
    model.available
      ? `  ${model.role} model ${model.name}: ${paint.ok('available')}`
      : `  ${model.role} model ${model.name}: ${paint.warn('MISSING')} (run: ollama pull ${model.name})`,
  );
  return [
    `Ollama:    ${paint.ok('reachable')} at ${ollama.url} (version ${ollama.version ?? 'unknown'})`,
    ...models,
  ];
}

/** One or two lines describing the result of a feed refresh. */
export function formatIngestSummary(summary: IngestSummary, paint: Palette = plainPalette): string[] {
  const lines = [
    `${paint.ok('Feed refreshed:')} ${summary.fetchedPosts} posts and ${summary.fetchedComments} comments from the past week ` +
      `(${summary.inserted} new, ${summary.updated} changed, ${summary.unchanged} unchanged). ` +
      `Embedded ${summary.embedded}.`,
  ];
  if (summary.embeddingError) {
    lines.push(
      paint.warn(
        `${summary.pendingEmbeddings} discussions are stored but not embedded yet: ${summary.embeddingError} ` +
          'Refresh again once this is fixed.',
      ),
    );
  }
  return lines;
}

function formatData(data: DataStatus | null, paint: Palette): string {
  if (!data) return `Data:      ${paint.problem('could not be read')}`;
  const total = data.posts + data.comments;
  if (total === 0) return `Data:      ${paint.warn('empty')} (choose "Refresh feed" to load the past week)`;
  const embedded = data.embedded === total ? paint.ok('all embedded') : paint.warn(`${data.embedded} of ${total} embedded`);
  const refreshed = data.lastIngestion ? `, last refresh ${data.lastIngestion.finishedAt}` : '';
  return `Data:      ${data.posts} posts and ${data.comments} comments, ${embedded}${refreshed}`;
}

export function formatHealth(health: HealthResponse, paint: Palette = plainPalette): string[] {
  const { database, source } = health;
  const databaseLine = database.ok
    ? `Database:  ${paint.ok('ok')}, sqlite-vec ${database.vectorExtensionVersion} (${database.path})`
    : `Database:  ${paint.problem('ERROR')} at ${database.path} (${database.error ?? 'unknown error'})`;
  return [
    `Overall:   ${health.status === 'ok' ? paint.ok('ok') : paint.warn('degraded')}`,
    databaseLine,
    ...formatOllama(health.ollama, paint),
    `Source:    ${source.community} on ${source.instanceUrl}`,
    formatData(health.data, paint),
  ];
}
