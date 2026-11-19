import type { GenerationRequest, TextGenerator } from './chat';
import type { Embedder } from './embeddings';

/** Test stand-in for the language model: replies with whatever `reply` returns and records each request. */
export function createScriptedGenerator(reply: (request: GenerationRequest) => string, model = 'scripted-test-model') {
  const requests: GenerationRequest[] = [];
  const generator: TextGenerator = {
    model,
    generate: async (request) => {
      requests.push(request);
      return { text: reply(request), durationMs: 5, promptTokens: 100, outputTokens: 50 };
    },
  };
  return { generator, requests };
}

/**
 * Test stand-in for an embedding model: each vector counts how often each
 * keyword appears, so texts sharing keywords come out similar. Deterministic
 * and offline. A final constant keeps texts with no keyword from being all zeros.
 */
export function createKeywordEmbedder(keywords: string[], model = 'keyword-test-model') {
  const calls: { documents: string[][]; queries: string[] } = { documents: [], queries: [] };
  const embed = (text: string): Float32Array => {
    const lower = text.toLowerCase();
    return Float32Array.from([...keywords.map((keyword) => lower.split(keyword).length - 1), 0.01]);
  };
  const embedder: Embedder = {
    model,
    embedDocuments: async (texts) => {
      calls.documents.push(texts);
      return texts.map(embed);
    },
    embedQuery: async (text) => {
      calls.queries.push(text);
      return embed(text);
    },
  };
  return { embedder, calls };
}
