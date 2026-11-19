import type { Discussion } from '../shared/discussions';
import type { Report, ReportEvaluation, ReportVariant, VariantMetrics } from '../shared/reports';

// Automatic, repeatable text checks that compare the two reports. They are
// rough indicators of grounding and specificity, not a judgment of quality.

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
const SENTENCE_END = /[.!?:;]["')\]]*$/;
const MAX_LISTED_TERMS = 12;

function wordsOf(text: string): string[] {
  return (text.toLowerCase().match(WORD) ?? []).flatMap((word) => [word, ...word.split(/['’-]/)]);
}

/** Every word used in the week's stored discussions, lowercased. */
export function buildVocabulary(discussions: Discussion[]): Set<string> {
  const vocabulary = new Set<string>();
  for (const discussion of discussions) {
    for (const word of wordsOf(`${discussion.title} ${discussion.body}`)) vocabulary.add(word);
  }
  return vocabulary;
}

/**
 * Finds the "named terms" in a passage: capitalized words that do not merely
 * start a sentence, plus acronyms and words containing digits. These are the
 * specifics (games, companies, version numbers) a report can get right or wrong.
 */
export function extractNamedTerms(text: string): string[] {
  const terms = new Set<string>();
  for (const match of text.matchAll(WORD)) {
    const word = match[0].replace(/['’]s$/, '');
    const before = text.slice(0, match.index).trimEnd();
    const startsSentence = before === '' || SENTENCE_END.test(before);
    const hasDigit = /\p{N}/u.test(word) && word.length >= 2;
    const isAcronym = word.length >= 2 && word === word.toUpperCase() && /\p{L}/u.test(word);
    const isCapitalized = word.length >= 3 && /^\p{Lu}/u.test(word);
    if (hasDigit || isAcronym || (isCapitalized && !startsSentence)) terms.add(word);
  }
  return [...terms];
}

/** The report's prose. Titles are left out because title case capitalizes ordinary words. */
function proseOf(report: Report): string[] {
  return [
    report.summary,
    ...report.themes.map((theme) => theme.description),
    ...report.predictions.flatMap((prediction) => [prediction.prediction, prediction.rationale]),
  ];
}

export function measureVariant(variant: ReportVariant, vocabulary: Set<string>): VariantMetrics {
  const { report } = variant;
  const items = [...report.themes, ...report.predictions];
  const terms = [...new Set(proseOf(report).flatMap(extractNamedTerms))];
  const notFound = terms.filter((term) => !wordsOf(term).some((word) => vocabulary.has(word)));
  const highConfidence = report.predictions.filter((prediction) => prediction.confidence === 'high');
  return {
    themes: report.themes.length,
    predictions: report.predictions.length,
    citedItems: items.filter((item) => item.sources.length > 0).length,
    distinctSources: new Set(items.flatMap((item) => item.sources)).size,
    invalidCitations: variant.invalidCitations.length,
    namedTerms: terms.length,
    namedTermsFound: terms.length - notFound.length,
    namedTermsNotFound: notFound,
    highConfidencePredictions: highConfidence.length,
    uncitedHighConfidencePredictions: highConfidence.filter((prediction) => prediction.sources.length === 0).length,
  };
}

function citationNote(name: string, metrics: VariantMetrics): string {
  const items = metrics.themes + metrics.predictions;
  return metrics.distinctSources === 0
    ? `${name} cites no sources for its ${items} themes and predictions.`
    : `${name} cites ${metrics.distinctSources} distinct sources across ${metrics.citedItems} of its ${items} themes and predictions.`;
}

function groundingNote(name: string, metrics: VariantMetrics): string {
  if (metrics.namedTerms === 0) return `${name} names no specific games, companies, or numbers.`;
  const missing = metrics.namedTermsNotFound.slice(0, MAX_LISTED_TERMS).join(', ');
  const tail = metrics.namedTermsNotFound.length > 0 ? ` Not found: ${missing}.` : '';
  return `${name}: ${metrics.namedTermsFound} of ${metrics.namedTerms} named terms appear in this week's discussions.${tail}`;
}

function confidenceNote(name: string, metrics: VariantMetrics): string | null {
  if (metrics.highConfidencePredictions === 0) return null;
  const uncited =
    metrics.uncitedHighConfidencePredictions > 0
      ? `, ${metrics.uncitedHighConfidencePredictions} of them without citing a source`
      : '';
  return `${name} marks ${metrics.highConfidencePredictions} of ${metrics.predictions} predictions as high confidence${uncited}. Predictions are forecasts either way.`;
}

function invalidCitationNote(name: string, variant: ReportVariant): string | null {
  if (variant.invalidCitations.length === 0) return null;
  return `${name} cited ${variant.invalidCitations.length} label(s) that were not in its evidence (${variant.invalidCitations.join(', ')}); they were removed.`;
}

/** Compares the two reports against the week's stored discussions. */
export function evaluateReports(
  baseline: ReportVariant,
  rag: ReportVariant,
  weekDiscussions: Discussion[],
): ReportEvaluation {
  const vocabulary = buildVocabulary(weekDiscussions);
  const baselineMetrics = measureVariant(baseline, vocabulary);
  const ragMetrics = measureVariant(rag, vocabulary);
  const notes = [
    citationNote('The RAG report', ragMetrics),
    citationNote('The baseline report', baselineMetrics),
    groundingNote('RAG grounding', ragMetrics),
    groundingNote('Baseline grounding', baselineMetrics),
    invalidCitationNote('The RAG report', rag),
    invalidCitationNote('The baseline report', baseline),
    confidenceNote('The RAG report', ragMetrics),
    confidenceNote('The baseline report', baselineMetrics),
    'These are automatic text checks against the stored discussions, not a judgment of writing quality.',
  ].filter((note): note is string => note !== null);
  return { baseline: baselineMetrics, rag: ragMetrics, notes };
}
