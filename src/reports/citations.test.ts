import { describe, expect, it } from 'vitest';
import { extractLabels, resolveCitations } from './citations';
import { passage, report } from './testSupport';

const EVIDENCE = [passage({ label: 'S1' }), passage({ label: 'S2' }), passage({ label: 'S12' })];

describe('extractLabels', () => {
  it('reads labels in the forms a model tends to write', () => {
    expect(extractLabels(['S1', '[S2]', 's12', 'S3, S4 and S5', 'Source S07'])).toEqual([
      'S1',
      'S2',
      'S12',
      'S3',
      'S4',
      'S5',
      'S7',
    ]);
  });

  it('removes repeats and ignores text without a label', () => {
    expect(extractLabels(['S1', '[S1]', 'none', '', 'SOURCE', 'XS1Y'])).toEqual(['S1']);
  });
});

describe('resolveCitations', () => {
  it('keeps citations that match the evidence', () => {
    const cited = report({
      themes: [{ title: 'T', description: 'D', sources: ['[S1]', 'S12, S2'] }],
    });
    const resolved = resolveCitations(cited, EVIDENCE);
    expect(resolved.report.themes[0]?.sources).toEqual(['S1', 'S12', 'S2']);
    expect(resolved.invalidCitations).toEqual([]);
  });

  it('removes labels that match no evidence and reports them', () => {
    const cited = report({
      themes: [{ title: 'T', description: 'D', sources: ['S1', 'S99'] }],
      predictions: [{ prediction: 'P', rationale: 'R', confidence: 'low', sources: ['S99', 'S42'] }],
    });
    const resolved = resolveCitations(cited, EVIDENCE);
    expect(resolved.report.themes[0]?.sources).toEqual(['S1']);
    expect(resolved.report.predictions[0]?.sources).toEqual([]);
    expect(resolved.invalidCitations).toEqual(['S99', 'S42']);
  });

  it('treats every citation as invalid when no evidence was given', () => {
    const resolved = resolveCitations(report(), []);
    expect(resolved.report.themes[0]?.sources).toEqual([]);
    expect(resolved.report.predictions[0]?.sources).toEqual([]);
    expect(resolved.invalidCitations).toEqual(['S1']);
  });

  it('leaves the rest of the report untouched', () => {
    const original = report();
    const resolved = resolveCitations(original, EVIDENCE);
    expect(resolved.report).toEqual(original);
  });
});
