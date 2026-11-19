import { describe, expect, it } from 'vitest';
import type { Discussion } from '../shared/discussions';
import { buildVocabulary, evaluateReports, extractNamedTerms, measureVariant } from './evaluation';
import { report, variant } from './testSupport';

function discussion(title: string, body: string): Discussion {
  return {
    id: `lemmy:test:post:${title}`,
    kind: 'post',
    community: 'games',
    postId: `lemmy:test:post:${title}`,
    title,
    body,
    author: null,
    url: 'https://test.invalid/post/1',
    linkUrl: null,
    score: 1,
    postedAt: '2026-01-14T10:00:00.000Z',
  };
}

const WEEK = [
  discussion('Starfall Odyssey delayed to March', 'The studio needs more time. Pre-orders stay valid.'),
  discussion('Emberdeep sells one million copies', "Emberdeep's publisher, Lanternlight, confirmed the figure."),
];

describe('extractNamedTerms', () => {
  it('finds capitalized names inside sentences', () => {
    expect(extractNamedTerms('Players discussed the Starfall Odyssey delay and Emberdeep sales.')).toEqual([
      'Starfall',
      'Odyssey',
      'Emberdeep',
    ]);
  });

  it('ignores a capitalized word that only starts a sentence', () => {
    expect(extractNamedTerms('Players were upset. Many asked for refunds: Some got them.')).toEqual([]);
  });

  it('keeps acronyms and words with digits wherever they appear', () => {
    expect(extractNamedTerms('GTA 6 reviews averaged 98 on PS5.')).toEqual(['GTA', '98', 'PS5']);
  });

  it("drops a possessive 's and repeats", () => {
    expect(extractNamedTerms("the delay hurt Emberdeep's launch, and Emberdeep fans noticed")).toEqual(['Emberdeep']);
  });
});

describe('measureVariant', () => {
  const vocabulary = buildVocabulary(WEEK);

  it('counts citations and grounded terms for a report based on the week', () => {
    const metrics = measureVariant(variant('rag'), vocabulary);
    expect(metrics).toMatchObject({
      themes: 1,
      predictions: 1,
      citedItems: 2,
      distinctSources: 1,
      invalidCitations: 0,
      namedTerms: 3,
      namedTermsFound: 3,
      namedTermsNotFound: [],
      highConfidencePredictions: 0,
    });
  });

  it('lists named terms that the week never mentioned', () => {
    const generic = variant('baseline', {
      report: report({
        summary: 'The community discussed Elden Ring and the Nintendo Switch 2.',
        themes: [{ title: 'Big releases', description: 'Fans of Starfall were excited.', sources: [] }],
        predictions: [
          { prediction: 'Talk about E3 may grow.', rationale: 'It usually does.', confidence: 'high', sources: [] },
        ],
      }),
    });
    const metrics = measureVariant(generic, vocabulary);
    expect(metrics.namedTermsNotFound).toEqual(['Elden', 'Ring', 'Nintendo', 'Switch', 'E3']);
    expect(metrics).toMatchObject({
      // Elden, Ring, Nintendo, Switch, Starfall, E3; the lone digit "2" is not counted.
      namedTerms: 6,
      namedTermsFound: 1,
      citedItems: 0,
      distinctSources: 0,
      highConfidencePredictions: 1,
      uncitedHighConfidencePredictions: 1,
    });
  });

  it('matches names regardless of letter case or a possessive in the source text', () => {
    const shouting = variant('rag', {
      report: report({ summary: 'Fans praised EMBERDEEP and Lanternlight.', themes: [], predictions: [] }),
    });
    expect(measureVariant(shouting, vocabulary).namedTermsNotFound).toEqual([]);
  });
});

describe('evaluateReports', () => {
  const baseline = variant('baseline', {
    report: report({
      summary: 'The community usually discusses Elden Ring.',
      themes: [{ title: 'General talk', description: 'People talk about games.', sources: [] }],
      predictions: [{ prediction: 'More talk is likely.', rationale: 'As usual.', confidence: 'high', sources: [] }],
    }),
  });
  const rag = variant('rag', { invalidCitations: ['S99'] });
  const evaluation = evaluateReports(baseline, rag, WEEK);

  it('measures both reports the same way', () => {
    expect(evaluation.rag.namedTermsFound).toBe(3);
    expect(evaluation.baseline.namedTermsNotFound).toEqual(['Elden', 'Ring']);
  });

  it('describes the differences in plain language', () => {
    expect(evaluation.notes).toEqual([
      'The RAG report cites 1 distinct sources across 2 of its 2 themes and predictions.',
      'The baseline report cites no sources for its 2 themes and predictions.',
      "RAG grounding: 3 of 3 named terms appear in this week's discussions.",
      "Baseline grounding: 0 of 2 named terms appear in this week's discussions. Not found: Elden, Ring.",
      'The RAG report cited 1 label(s) that were not in its evidence (S99); they were removed.',
      'The baseline report marks 1 of 1 predictions as high confidence, 1 of them without citing a source. Predictions are forecasts either way.',
      'These are automatic text checks against the stored discussions, not a judgment of writing quality.',
    ]);
  });
});
