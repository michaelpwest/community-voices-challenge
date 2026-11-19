import { describe, expect, it } from 'vitest';
import { createOllamaGenerator, GenerationError, type GenerationRequest } from './chat';

const URL = 'http://ollama.test:11434';

const REQUEST: GenerationRequest = {
  messages: [
    { role: 'system', content: 'Rules' },
    { role: 'user', content: 'Write the report.' },
  ],
  jsonSchema: { type: 'object' },
  options: { numCtx: 16384, temperature: 0.2, seed: 42, maxOutputTokens: 2500 },
};

/** A streamed reply whose network chunks are cut at arbitrary points, as real ones are. */
function streamed(lines: unknown[], chunkSize = 17): Response {
  const bytes = new TextEncoder().encode(lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let start = 0; start < bytes.length; start += chunkSize) {
        controller.enqueue(bytes.slice(start, start + chunkSize));
      }
      controller.close();
    },
  });
  return new Response(body);
}

function generatorReturning(response: () => Response) {
  const bodies: Array<Record<string, unknown>> = [];
  const fetchFn: typeof fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return response();
  };
  return { generator: createOllamaGenerator({ url: URL, model: 'llama3.1:8b', fetchFn }), bodies };
}

describe('createOllamaGenerator', () => {
  it('joins the streamed pieces and reports token counts', async () => {
    const { generator } = generatorReturning(() =>
      streamed([
        { message: { content: '{"summary":' }, done: false },
        { message: { content: '"A week of café talk"}' }, done: false },
        { message: { content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 4200, eval_count: 640 },
      ]),
    );
    const result = await generator.generate(REQUEST);
    expect(result.text).toBe('{"summary":"A week of café talk"}');
    expect(result).toMatchObject({ promptTokens: 4200, outputTokens: 640 });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('sends the schema and every sampling setting, including the context size', async () => {
    const { generator, bodies } = generatorReturning(() => streamed([{ message: { content: '{}' }, done: true }]));
    await generator.generate(REQUEST);
    expect(bodies[0]).toEqual({
      model: 'llama3.1:8b',
      messages: REQUEST.messages,
      format: { type: 'object' },
      stream: true,
      options: { num_ctx: 16384, temperature: 0.2, seed: 42, num_predict: 2500 },
    });
  });

  it('explains that Ollama is unreachable', async () => {
    const fetchFn: typeof fetch = async () => {
      throw new TypeError('fetch failed');
    };
    const generator = createOllamaGenerator({ url: URL, model: 'llama3.1:8b', fetchFn });
    await expect(generator.generate(REQUEST)).rejects.toBeInstanceOf(GenerationError);
    await expect(generator.generate(REQUEST)).rejects.toThrow(`Ollama is not reachable at ${URL}.`);
  });

  it('tells the user how to get a missing model', async () => {
    const { generator } = generatorReturning(() =>
      Response.json({ error: "model 'llama3.1:8b' not found" }, { status: 404 }),
    );
    await expect(generator.generate(REQUEST)).rejects.toThrow(/Run: ollama pull llama3\.1:8b/);
  });

  it('reports an error that arrives mid-stream', async () => {
    const { generator } = generatorReturning(() =>
      streamed([{ message: { content: '{"sum' }, done: false }, { error: 'out of memory' }]),
    );
    await expect(generator.generate(REQUEST)).rejects.toThrow(/could not generate the report: out of memory/);
  });

  it('rejects a reply that was cut off by the output limit', async () => {
    const { generator } = generatorReturning(() =>
      streamed([{ message: { content: '{"summary":"unfinished' }, done: true, done_reason: 'length' }]),
    );
    await expect(generator.generate(REQUEST)).rejects.toThrow(/2500-token output limit/);
  });

  it('rejects a stream that ends without a final message', async () => {
    const { generator } = generatorReturning(() => streamed([{ message: { content: '{"summary":' }, done: false }]));
    await expect(generator.generate(REQUEST)).rejects.toThrow(/stopped before finishing/);
  });

  it('rejects a stream that is not Ollama output', async () => {
    const { generator } = generatorReturning(() => new Response('<html>proxy error</html>\n'));
    await expect(generator.generate(REQUEST)).rejects.toThrow(/could not be read/);
  });
});
