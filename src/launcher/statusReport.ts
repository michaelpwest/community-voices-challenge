import type { OllamaStatus } from '../shared/health';
import { plainPalette, type Palette } from './palette';

/** Terminal lines describing whether Ollama and the configured models are ready. */
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
