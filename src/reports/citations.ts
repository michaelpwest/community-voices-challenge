import type { EvidencePassage, Report } from '../shared/reports';

const LABEL = /\bS(\d+)\b/gi;

/** Reads citation labels however the model wrote them: "S3", "[s3]", or "S1, S2" in one string. */
export function extractLabels(values: string[]): string[] {
  const labels = new Set<string>();
  for (const value of values) {
    for (const match of value.matchAll(LABEL)) labels.add(`S${Number(match[1])}`);
  }
  return [...labels];
}

export interface ResolvedCitations {
  /** The report with each `sources` list reduced to labels that exist in the evidence. */
  report: Report;
  /** Cited labels that match no evidence passage. */
  invalidCitations: string[];
}

/**
 * Checks every citation against the evidence the model was actually given.
 * A label that matches no passage is removed from the report and reported
 * separately, so a made-up source can never be shown as support for a claim.
 */
export function resolveCitations(report: Report, evidence: EvidencePassage[]): ResolvedCitations {
  const known = new Set(evidence.map((passage) => passage.label));
  const invalid = new Set<string>();
  const validOnly = (sources: string[]): string[] =>
    extractLabels(sources).filter((label) => {
      if (known.has(label)) return true;
      invalid.add(label);
      return false;
    });

  return {
    report: {
      ...report,
      themes: report.themes.map((theme) => ({ ...theme, sources: validOnly(theme.sources) })),
      predictions: report.predictions.map((prediction) => ({ ...prediction, sources: validOnly(prediction.sources) })),
    },
    invalidCitations: [...invalid],
  };
}
