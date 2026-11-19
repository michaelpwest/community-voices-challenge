import { describe, expect, it } from 'vitest';
import { parseReport, ReportFormatError, reportJsonSchema } from './reportSchema';
import { report } from './testSupport';

describe('parseReport', () => {
  it('accepts a complete report', () => {
    expect(parseReport(JSON.stringify(report()))).toEqual(report());
  });

  it('accepts a report with no limitations and no sources', () => {
    const minimal = report({
      limitations: [],
      themes: [{ title: 'A theme', description: 'About something.', sources: [] }],
    });
    expect(parseReport(JSON.stringify(minimal)).themes[0]?.sources).toEqual([]);
  });

  it('rejects text that is not JSON', () => {
    expect(() => parseReport('Here is your report: ...')).toThrow(ReportFormatError);
    expect(() => parseReport('{"summary": "cut off')).toThrow(/did not return valid JSON/);
  });

  it.each([
    ['a missing section', { ...report(), predictions: undefined }],
    ['no themes', report({ themes: [] })],
    ['a blank summary', report({ summary: '   ' })],
    ['an unknown confidence level', { ...report(), predictions: [{ ...report().predictions[0], confidence: 'certain' }] }],
    ['sources that are not a list', { ...report(), themes: [{ ...report().themes[0], sources: 'S1' }] }],
  ])('rejects a report with %s', (_label, value) => {
    expect(() => parseReport(JSON.stringify(value))).toThrow(/unexpected shape/);
  });
});

describe('reportJsonSchema', () => {
  it('requires every section, so the model cannot omit one', () => {
    expect(reportJsonSchema).toMatchObject({
      type: 'object',
      required: ['summary', 'themes', 'predictions', 'limitations'],
    });
  });

  it('limits confidence to three levels', () => {
    expect(JSON.stringify(reportJsonSchema)).toContain('"enum":["low","medium","high"]');
  });
});
