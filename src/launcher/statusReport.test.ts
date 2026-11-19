import { describe, expect, it } from 'vitest';
import type { HealthResponse } from '../shared/health';
import { formatHealth } from './statusReport';

const health: HealthResponse = {
  status: 'degraded',
  checkedAt: '2026-11-18T12:00:00.000Z',
  database: { path: '/project/data/app.db', ok: true, vectorExtensionVersion: 'v0.1.9', error: null },
  ollama: {
    url: 'http://localhost:11434',
    reachable: true,
    version: '0.99.0',
    models: [
      { name: 'llama3.1:8b', role: 'generation', available: true },
      { name: 'nomic-embed-text', role: 'embedding', available: false },
    ],
    error: null,
  },
  source: { instanceUrl: 'https://lemmy.world', community: 'games' },
};

describe('formatHealth', () => {
  it('shows each component and the command that fixes a missing model', () => {
    const text = formatHealth(health).join('\n');
    expect(text).toContain('Overall:   degraded');
    expect(text).toContain('sqlite-vec v0.1.9');
    expect(text).toContain('generation model llama3.1:8b: available');
    expect(text).toContain('MISSING (run: ollama pull nomic-embed-text)');
    expect(text).toContain('games on https://lemmy.world');
  });

  it('explains an unreachable Ollama and a failed database', () => {
    const text = formatHealth({
      ...health,
      database: { ...health.database, ok: false, vectorExtensionVersion: null, error: 'unable to open' },
      ollama: { ...health.ollama, reachable: false, version: null, error: 'connect ECONNREFUSED' },
    }).join('\n');
    expect(text).toContain('Database:  ERROR at /project/data/app.db (unable to open)');
    expect(text).toContain('NOT REACHABLE at http://localhost:11434 (connect ECONNREFUSED)');
  });
});
