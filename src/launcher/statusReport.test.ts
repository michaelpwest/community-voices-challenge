import { describe, expect, it } from 'vitest';
import type { OllamaStatus } from '../shared/health';
import { formatOllama } from './statusReport';

const ollama: OllamaStatus = {
  url: 'http://localhost:11434',
  reachable: true,
  version: '0.99.0',
  models: [
    { name: 'llama3.1:8b', role: 'generation', available: true },
    { name: 'nomic-embed-text', role: 'embedding', available: false },
  ],
  error: null,
};

describe('formatOllama', () => {
  it('shows each model and the command that fixes a missing one', () => {
    expect(formatOllama(ollama)).toEqual([
      'Ollama:    reachable at http://localhost:11434 (version 0.99.0)',
      '  generation model llama3.1:8b: available',
      '  embedding model nomic-embed-text: MISSING (run: ollama pull nomic-embed-text)',
    ]);
  });

  it('explains an unreachable Ollama', () => {
    const down = { ...ollama, reachable: false, version: null, error: 'connect ECONNREFUSED' };
    expect(formatOllama(down)).toEqual([
      'Ollama:    NOT REACHABLE at http://localhost:11434 (connect ECONNREFUSED)',
    ]);
  });
});
