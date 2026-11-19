import { describe, expect, it } from 'vitest';
import { createOllamaEmbedder, EmbeddingError, embeddingPrefixes } from './embeddings';

const URL = 'http://ollama.test:11434';

interface EmbedRequest {
  model: string;
  input: string[];
  truncate: boolean;
}

/** Answers like Ollama's /api/embed, returning [input length, 1] for each input. */
function fakeOllama() {
  const requests: EmbedRequest[] = [];
  const fetchFn: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as EmbedRequest;
    requests.push(request);
    return Response.json({ embeddings: request.input.map((text) => [text.length, 1]) });
  };
  return { fetchFn, requests };
}

describe('embeddingPrefixes', () => {
  it('uses task prefixes for nomic-embed-text, with or without a tag', () => {
    expect(embeddingPrefixes('nomic-embed-text')).toEqual({ document: 'search_document: ', query: 'search_query: ' });
    expect(embeddingPrefixes('nomic-embed-text:latest').query).toBe('search_query: ');
  });

  it('adds no prefix for other models', () => {
    expect(embeddingPrefixes('mxbai-embed-large')).toEqual({ document: '', query: '' });
  });
});

describe('createOllamaEmbedder', () => {
  it('prefixes documents and queries differently', async () => {
    const { fetchFn, requests } = fakeOllama();
    const embedder = createOllamaEmbedder({ url: URL, embedModel: 'nomic-embed-text', fetchFn });
    await embedder.embedDocuments(['a post']);
    await embedder.embedQuery('a question');
    expect(requests.map((request) => request.input)).toEqual([['search_document: a post'], ['search_query: a question']]);
    expect(requests[0]).toMatchObject({ model: 'nomic-embed-text', truncate: true });
  });

  it('splits many documents into batches and keeps their order', async () => {
    const { fetchFn, requests } = fakeOllama();
    const embedder = createOllamaEmbedder({ url: URL, embedModel: 'other-model', fetchFn, batchSize: 2 });
    const vectors = await embedder.embedDocuments(['a', 'bb', 'ccc', 'dddd', 'eeeee']);
    expect(requests.map((request) => request.input.length)).toEqual([2, 2, 1]);
    expect(vectors.map((vector) => vector[0])).toEqual([1, 2, 3, 4, 5]);
    expect(vectors[0]).toBeInstanceOf(Float32Array);
  });

  it('makes no request for an empty list', async () => {
    const { fetchFn, requests } = fakeOllama();
    const embedder = createOllamaEmbedder({ url: URL, embedModel: 'other-model', fetchFn });
    expect(await embedder.embedDocuments([])).toEqual([]);
    expect(requests).toHaveLength(0);
  });

  it('explains that Ollama is unreachable', async () => {
    const fetchFn: typeof fetch = async () => {
      throw new TypeError('fetch failed');
    };
    const embedder = createOllamaEmbedder({ url: URL, embedModel: 'other-model', fetchFn });
    await expect(embedder.embedQuery('x')).rejects.toBeInstanceOf(EmbeddingError);
    await expect(embedder.embedQuery('x')).rejects.toThrow(`Ollama is not reachable at ${URL}.`);
  });

  it('tells the user how to get a missing model', async () => {
    const fetchFn: typeof fetch = async () => Response.json({ error: 'model "nope" not found' }, { status: 404 });
    const embedder = createOllamaEmbedder({ url: URL, embedModel: 'nope', fetchFn });
    await expect(embedder.embedQuery('x')).rejects.toThrow(/Run: ollama pull nope/);
  });

  it('passes on other Ollama errors', async () => {
    const fetchFn: typeof fetch = async () => Response.json({ error: 'out of memory' }, { status: 500 });
    const embedder = createOllamaEmbedder({ url: URL, embedModel: 'other-model', fetchFn });
    await expect(embedder.embedQuery('x')).rejects.toThrow(/could not create embeddings: out of memory/);
  });

  it.each([
    ['fewer vectors than inputs', { embeddings: [[1, 2]] }],
    ['vectors of different sizes', { embeddings: [[1, 2], [1]] }],
    ['empty vectors', { embeddings: [[], []] }],
    ['a different shape', { data: [] }],
  ])('rejects a reply with %s', async (_label, body) => {
    const fetchFn: typeof fetch = async () => Response.json(body);
    const embedder = createOllamaEmbedder({ url: URL, embedModel: 'other-model', fetchFn });
    await expect(embedder.embedDocuments(['a', 'b'])).rejects.toBeInstanceOf(EmbeddingError);
  });
});
