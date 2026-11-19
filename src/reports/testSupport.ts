import type { EvidencePassage, Report, ReportVariant } from '../shared/reports';

// Shared sample data for report tests.

export function passage(overrides: Partial<EvidencePassage> = {}): EvidencePassage {
  return {
    label: 'S1',
    discussionId: 'lemmy:test:post:1',
    kind: 'post',
    title: 'Starfall Odyssey delayed to March',
    excerpt: 'The studio says it needs more time for polish.',
    url: 'https://test.invalid/post/1',
    postedAt: '2026-01-15T09:00:00.000Z',
    score: 120,
    selectedBy: [{ method: 'engagement', query: null, similarity: null }],
    ...overrides,
  };
}

export function report(overrides: Partial<Report> = {}): Report {
  return {
    summary: 'Players mostly discussed the Starfall Odyssey delay.',
    themes: [
      { title: 'Starfall Odyssey delay', description: 'Most players accepted the delay to March.', sources: ['S1'] },
    ],
    predictions: [
      {
        prediction: 'Players may keep debating the Starfall Odyssey delay.',
        rationale: 'The thread was still active at the end of the week.',
        confidence: 'medium',
        sources: ['S1'],
      },
    ],
    limitations: ['Only a sample of the week was reviewed.'],
    ...overrides,
  };
}

export function variant(kind: ReportVariant['kind'], overrides: Partial<ReportVariant> = {}): ReportVariant {
  return {
    kind,
    report: report(),
    invalidCitations: [],
    durationMs: 12_000,
    promptTokens: 4000,
    outputTokens: 600,
    ...overrides,
  };
}
