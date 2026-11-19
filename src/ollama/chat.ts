import { z } from 'zod';

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

/** Sampling settings sent with every request. Identical for baseline and RAG runs. */
export interface GenerationOptions {
  numCtx: number;
  temperature: number;
  seed: number;
  maxOutputTokens: number;
}

export interface GenerationRequest {
  messages: ChatMessage[];
  /** JSON Schema the reply must follow. */
  jsonSchema: unknown;
  options: GenerationOptions;
}

export interface GenerationResult {
  text: string;
  durationMs: number;
  promptTokens: number | null;
  outputTokens: number | null;
}

/** Produces schema-constrained JSON text from a chat prompt. */
export interface TextGenerator {
  readonly model: string;
  generate(request: GenerationRequest): Promise<GenerationResult>;
}

/** Text could not be generated: Ollama is unreachable, the model is missing, or the reply was unusable. */
export class GenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerationError';
  }
}

export interface OllamaGeneratorOptions {
  url: string;
  model: string;
  fetchFn?: typeof fetch;
  /** Limit for one whole generation. CPU-only machines can need many minutes. */
  timeoutMs?: number;
}

const chunkSchema = z.object({
  message: z.object({ content: z.string() }).optional(),
  done: z.boolean().optional(),
  done_reason: z.string().optional(),
  prompt_eval_count: z.number().optional(),
  eval_count: z.number().optional(),
  error: z.string().optional(),
});

const errorResponseSchema = z.object({ error: z.string() });

type Chunk = z.infer<typeof chunkSchema>;

/** Reads Ollama's streamed reply: one JSON object per line, possibly split across network chunks. */
async function* readChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<Chunk> {
  const decoder = new TextDecoder();
  let buffered = '';
  const parse = (line: string): Chunk => {
    try {
      return chunkSchema.parse(JSON.parse(line));
    } catch {
      throw new GenerationError('Ollama sent a reply that could not be read.');
    }
  };
  for await (const bytes of body) {
    buffered += decoder.decode(bytes, { stream: true });
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim() !== '') yield parse(line);
    }
  }
  if (buffered.trim() !== '') yield parse(buffered);
}

async function describeFailure(response: Response, model: string): Promise<string> {
  const parsed = errorResponseSchema.safeParse(await response.json().catch(() => undefined));
  const detail = parsed.success ? parsed.data.error : `HTTP ${response.status}`;
  return response.status === 404
    ? `Ollama does not have the model "${model}" (${detail}). Run: ollama pull ${model}`
    : `Ollama could not generate the report: ${detail}`;
}

export function createOllamaGenerator(options: OllamaGeneratorOptions): TextGenerator {
  const { url, model, fetchFn = fetch, timeoutMs = 20 * 60_000 } = options;

  async function generate(request: GenerationRequest): Promise<GenerationResult> {
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetchFn(`${url}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: request.messages,
          format: request.jsonSchema,
          // Streaming keeps the connection active during long generations.
          stream: true,
          options: {
            // Ollama's default context is small and cuts long prompts silently, so it is always set.
            num_ctx: request.options.numCtx,
            temperature: request.options.temperature,
            seed: request.options.seed,
            num_predict: request.options.maxOutputTokens,
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new GenerationError(
        timedOut ? `Ollama at ${url} did not answer in time.` : `Ollama is not reachable at ${url}.`,
      );
    }
    if (!response.ok) throw new GenerationError(await describeFailure(response, model));
    if (!response.body) throw new GenerationError('Ollama returned an empty reply.');

    let text = '';
    let final: Chunk | undefined;
    try {
      for await (const chunk of readChunks(response.body)) {
        if (chunk.error) throw new GenerationError(`Ollama could not generate the report: ${chunk.error}`);
        text += chunk.message?.content ?? '';
        if (chunk.done) final = chunk;
      }
    } catch (error) {
      if (error instanceof GenerationError) throw error;
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new GenerationError(
        timedOut ? 'The model took too long to finish the report.' : 'The connection to Ollama was lost mid-reply.',
      );
    }

    if (!final) throw new GenerationError('Ollama stopped before finishing its reply.');
    if (final.done_reason === 'length') {
      throw new GenerationError(
        `The model hit the ${request.options.maxOutputTokens}-token output limit before finishing the report.`,
      );
    }
    return {
      text,
      durationMs: Date.now() - startedAt,
      promptTokens: final.prompt_eval_count ?? null,
      outputTokens: final.eval_count ?? null,
    };
  }

  return { model, generate };
}
