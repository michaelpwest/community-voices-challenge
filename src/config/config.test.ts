import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';

const BASE_DIR = resolve('/project');

describe('loadConfig', () => {
  it('applies documented defaults when nothing is set', () => {
    const config = loadConfig({}, BASE_DIR);
    expect(config.webPort).toBe(3000);
    expect(config.apiPort).toBe(3001);
    expect(config.ollama).toEqual({
      url: 'http://localhost:11434',
      model: 'llama3.1:8b',
      embedModel: 'nomic-embed-text',
      numCtx: 16384,
    });
    expect(config.source).toEqual({ instanceUrl: 'https://lemmy.world', community: 'games' });
    expect(config.databasePath).toBe(resolve(BASE_DIR, 'data/community-voices.db'));
  });

  it('reads overrides and trims trailing slashes from URLs', () => {
    const config = loadConfig(
      { API_PORT: '4001', OLLAMA_URL: 'http://gpu-box:11434/', OLLAMA_MODEL: 'qwen3:8b', OLLAMA_NUM_CTX: '8192' },
      BASE_DIR,
    );
    expect(config.apiPort).toBe(4001);
    expect(config.ollama.url).toBe('http://gpu-box:11434');
    expect(config.ollama.model).toBe('qwen3:8b');
    expect(config.ollama.numCtx).toBe(8192);
  });

  it('treats blank values as unset', () => {
    expect(loadConfig({ API_PORT: '', OLLAMA_URL: '   ' }, BASE_DIR).apiPort).toBe(3001);
  });

  it('names every invalid variable', () => {
    const load = (): unknown => loadConfig({ API_PORT: 'abc', OLLAMA_URL: 'ftp://host', WEB_PORT: '70000' }, BASE_DIR);
    expect(load).toThrow(ConfigError);
    expect(load).toThrow(/API_PORT/);
    expect(load).toThrow(/OLLAMA_URL: must be an http/);
    expect(load).toThrow(/WEB_PORT/);
  });

  it('rejects identical web and API ports', () => {
    expect(() => loadConfig({ WEB_PORT: '3001' }, BASE_DIR)).toThrow(/must differ/);
  });
});
