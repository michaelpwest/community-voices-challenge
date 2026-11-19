import { z } from 'zod';

/** Turns text into vectors. Documents and queries are embedded differently by some models. */
export interface Embedder {
  readonly model: string;
  embedDocuments(texts: string[]): Promise<Float32Array[]>;
  embedQuery(text: string): Promise<Float32Array>;
}

/** Embeddings could not be produced: Ollama is unreachable, the model is missing, or the reply was malformed. */
export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

export interface OllamaEmbedderOptions {
  url: string;
  embedModel: string;
  fetchFn?: typeof fetch;
  batchSize?: number;
  /** Generous by default: the first request also loads the model into memory. */
  timeoutMs?: number;
}

const embedResponseSchema = z.object({ embeddings: z.array(z.array(z.number())) });
const errorResponseSchema = z.object({ error: z.string() });

/**
 * nomic-embed-text is trained with task prefixes and retrieves poorly without
 * them. Other models get no prefix, since each defines its own convention.
 */
export function embeddingPrefixes(model: string): { document: string; query: string } {
  return model.startsWith('nomic-embed-text')
    ? { document: 'search_document: ', query: 'search_query: ' }
    : { document: '', query: '' };
}

async function describeFailure(response: Response, model: string): Promise<string> {
  const parsed = errorResponseSchema.safeParse(await response.json().catch(() => undefined));
  const detail = parsed.success ? parsed.data.error : `HTTP ${response.status}`;
  return response.status === 404
    ? `Ollama does not have the embedding model "${model}" (${detail}). Run: ollama pull ${model}`
    : `Ollama could not create embeddings: ${detail}`;
}

export function createOllamaEmbedder(options: OllamaEmbedderOptions): Embedder {
  const { url, embedModel: model, fetchFn = fetch, batchSize = 16, timeoutMs = 120_000 } = options;
  const prefixes = embeddingPrefixes(model);

  async function embedBatch(inputs: string[]): Promise<Float32Array[]> {
    let response: Response;
    try {
      response = await fetchFn(`${url}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // truncate: text beyond the model's context is cut rather than rejected.
        body: JSON.stringify({ model, input: inputs, truncate: true }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new EmbeddingError(
        timedOut ? `Ollama at ${url} did not answer in time.` : `Ollama is not reachable at ${url}.`,
      );
    }
    if (!response.ok) throw new EmbeddingError(await describeFailure(response, model));

    const parsed = embedResponseSchema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) throw new EmbeddingError('Ollama returned an unexpected embedding response.');
    const vectors = parsed.data.embeddings;
    const dimensions = vectors[0]?.length ?? 0;
    const wellFormed =
      vectors.length === inputs.length &&
      dimensions > 0 &&
      vectors.every((vector) => vector.length === dimensions && vector.every(Number.isFinite));
    if (!wellFormed) throw new EmbeddingError('Ollama returned embeddings of an unexpected count or size.');
    return vectors.map((vector) => Float32Array.from(vector));
  }

  async function embedAll(inputs: string[]): Promise<Float32Array[]> {
    const vectors: Float32Array[] = [];
    for (let start = 0; start < inputs.length; start += batchSize) {
      vectors.push(...(await embedBatch(inputs.slice(start, start + batchSize))));
    }
    return vectors;
  }

  return {
    model,
    embedDocuments: (texts) => embedAll(texts.map((text) => `${prefixes.document}${text}`)),
    embedQuery: async (text) => {
      const [vector] = await embedAll([`${prefixes.query}${text}`]);
      if (!vector) throw new EmbeddingError('Ollama returned no embedding for the query.');
      return vector;
    },
  };
}
