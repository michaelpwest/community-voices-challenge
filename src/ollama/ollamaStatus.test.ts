import { describe, expect, it } from 'vitest';
import { checkOllama, isOllamaReady, missingModels, normalizeModelName, type FetchFn } from './ollamaStatus';

const SETTINGS = { url: 'http://ollama.test:11434', model: 'llama3.1:8b', embedModel: 'nomic-embed-text' };

function fakeOllama(installedModels: string[]): FetchFn {
  return async (input) => {
    const url = String(input);
    if (url.endsWith('/api/tags')) return Response.json({ models: installedModels.map((name) => ({ name })) });
    if (url.endsWith('/api/version')) return Response.json({ version: '0.99.0' });
    return new Response('not found', { status: 404 });
  };
}

describe('normalizeModelName', () => {
  it('adds the implicit :latest tag only when no tag is given', () => {
    expect(normalizeModelName('nomic-embed-text')).toBe('nomic-embed-text:latest');
    expect(normalizeModelName('llama3.1:8b')).toBe('llama3.1:8b');
  });
});

describe('checkOllama', () => {
  it('reports ready when both models are installed', async () => {
    const status = await checkOllama(SETTINGS, fakeOllama(['llama3.1:8b', 'nomic-embed-text:latest']));
    expect(status).toMatchObject({ reachable: true, version: '0.99.0', error: null });
    expect(missingModels(status)).toEqual([]);
    expect(isOllamaReady(status)).toBe(true);
  });

  it('lists models that have not been pulled', async () => {
    const status = await checkOllama(SETTINGS, fakeOllama(['llama3.1:8b']));
    expect(status.reachable).toBe(true);
    expect(missingModels(status)).toEqual(['nomic-embed-text']);
    expect(isOllamaReady(status)).toBe(false);
  });

  it('does not treat a different tag of the same model as installed', async () => {
    const status = await checkOllama(SETTINGS, fakeOllama(['llama3.1:70b', 'nomic-embed-text:latest']));
    expect(missingModels(status)).toEqual(['llama3.1:8b']);
  });

  it('reports unreachable with a reason when the connection fails', async () => {
    const refuse: FetchFn = async () => {
      throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED') });
    };
    const status = await checkOllama(SETTINGS, refuse);
    expect(status.reachable).toBe(false);
    expect(status.error).toContain('ECONNREFUSED');
    expect(isOllamaReady(status)).toBe(false);
  });

  it('reports unreachable when the server is not Ollama', async () => {
    const otherServer: FetchFn = async () => Response.json({ hello: 'world' });
    const status = await checkOllama(SETTINGS, otherServer);
    expect(status.reachable).toBe(false);
    expect(status.error).toContain('unexpected response shape');
  });

  it('reports unreachable on an HTTP error', async () => {
    const failing: FetchFn = async () => new Response('nope', { status: 500 });
    const status = await checkOllama(SETTINGS, failing);
    expect(status.reachable).toBe(false);
    expect(status.error).toContain('HTTP 500');
  });
});
