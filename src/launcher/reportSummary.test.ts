import { describe, expect, it } from 'vitest';
import { passage, report, variant } from '../reports/testSupport';
import type { ReportRun } from '../shared/reports';
import { formatReportRun } from './reportSummary';

const metrics = {
  themes: 1,
  predictions: 1,
  citedItems: 2,
  distinctSources: 1,
  invalidCitations: 0,
  namedTerms: 3,
  namedTermsFound: 3,
  namedTermsNotFound: [],
  highConfidencePredictions: 0,
  uncitedHighConfidencePredictions: 0,
};

const run: ReportRun = {
  id: 1,
  community: 'games',
  windowStart: '2026-01-08T12:00:00.000Z',
  windowEnd: '2026-01-15T12:00:00.000Z',
  generatedAt: '2026-01-15T12:01:00.000Z',
  dataRefreshedAt: '2026-01-15T11:00:00.000Z',
  settings: {
    model: 'llama3.1:8b',
    embeddingModel: 'nomic-embed-text',
    promptVersion: 'test',
    numCtx: 16384,
    temperature: 0.2,
    seed: 42,
    maxOutputTokens: 2500,
  },
  evidence: [passage(), passage({ label: 'S2' })],
  baseline: variant('baseline', {
    durationMs: 4200,
    report: report({
      themes: [{ title: 'General discussion', description: 'People talk about games.', sources: [] }],
      predictions: [{ prediction: 'More talk is likely.', rationale: 'As usual.', confidence: 'low', sources: [] }],
    }),
  }),
  rag: variant('rag'),
  evaluation: { baseline: metrics, rag: metrics, notes: ['The RAG report cites 1 distinct sources.'] },
  warnings: [],
};

describe('formatReportRun', () => {
  const text = formatReportRun(run).join('\n');

  it('names the period and the model shared by both runs', () => {
    expect(text).toContain('Reports generated for games, 2026-01-08 to 2026-01-15, both with llama3.1:8b.');
  });

  it('labels the baseline as unverified general knowledge', () => {
    expect(text).toContain('Baseline: same model, no retrieved evidence (general knowledge, not verified activity) (4s)');
    expect(text).toContain('    - General discussion\n');
  });

  it('shows RAG themes and predictions with their sources and confidence', () => {
    expect(text).toContain('RAG: 2 retrieved posts and comments as evidence (12s)');
    expect(text).toContain('    - Starfall Odyssey delay [S1]');
    expect(text).toContain('    - (medium confidence) Players may keep debating the Starfall Odyssey delay. [S1]');
  });

  it('lists the comparison notes and any warnings', () => {
    expect(text).toContain('Comparison\n  - The RAG report cites 1 distinct sources.');
    const warned = formatReportRun({ ...run, warnings: ['Data is two days old.'] }).join('\n');
    expect(warned).toContain('Warning: Data is two days old.');
  });
});
