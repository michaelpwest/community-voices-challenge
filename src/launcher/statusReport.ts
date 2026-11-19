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
  ];
}
