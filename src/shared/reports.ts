// Report types shared by the API, the launcher, and the web UI.
// Type-only imports keep this file usable by the browser build.

import type { DiscussionKind } from './discussions';

export type Confidence = 'low' | 'medium' | 'high';

export interface ReportTheme {
  title: string;
  description: string;
  /** Labels of the evidence passages that support this theme, e.g. `S3`. */
  sources: string[];
}

export interface ReportPrediction {
  prediction: string;
  rationale: string;
  confidence: Confidence;
  sources: string[];
}

/** The Community Voices document. Baseline and RAG runs produce the same shape. */
export interface Report {
  /** What the community discussed in the past week. */
  summary: string;
  themes: ReportTheme[];
  /** Forecasts for the coming week. These are expectations, not observed activity. */
  predictions: ReportPrediction[];
  limitations: string[];
}

/** How a passage came to be included in the evidence. */
export interface EvidenceSelection {
  method: 'engagement' | 'similarity';
  /** The retrieval query, for `similarity`. */
  query: string | null;
  /** Cosine similarity to that query, for `similarity`. */
  similarity: number | null;
}

/** One post or comment given to the model as evidence in the RAG run. */
export interface EvidencePassage {
  /** Citation label used in the prompt and in the report, e.g. `S3`. */
  label: string;
  discussionId: string;
  kind: DiscussionKind;
  title: string;
  /** The text shown to the model (may be shortened from the stored body). */
  excerpt: string;
  url: string;
  postedAt: string;
  score: number;
  selectedBy: EvidenceSelection[];
}

export type ReportVariantKind = 'baseline' | 'rag';

export interface ReportVariant {
  kind: ReportVariantKind;
  /** Citations here are limited to labels that exist in the evidence. */
  report: Report;
  /** Labels the model cited that do not exist in the evidence it was given. */
  invalidCitations: string[];
  durationMs: number;
  promptTokens: number | null;
  outputTokens: number | null;
}

/** Automatic text checks on one report. Rough indicators, not a quality judgment. */
export interface VariantMetrics {
  themes: number;
  predictions: number;
  /** Themes and predictions that cite at least one valid source. */
  citedItems: number;
  distinctSources: number;
  invalidCitations: number;
  /** Capitalized names and numbers in the report text. */
  namedTerms: number;
  /** How many of those also appear in the week's stored discussions. */
  namedTermsFound: number;
  namedTermsNotFound: string[];
  highConfidencePredictions: number;
  /** High-confidence predictions that cite no source. */
  uncitedHighConfidencePredictions: number;
}

export interface ReportEvaluation {
  baseline: VariantMetrics;
  rag: VariantMetrics;
  /** Plain-language observations derived from the metrics. */
  notes: string[];
}

/** Everything that was held constant between the baseline and RAG runs. */
export interface RunSettings {
  model: string;
  embeddingModel: string;
  promptVersion: string;
  numCtx: number;
  temperature: number;
  seed: number;
  maxOutputTokens: number;
}

export interface ReportRun {
  id: number;
  community: string;
  /** The past week the report covers. */
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
  /** When the community data used here was last refreshed, if known. */
  dataRefreshedAt: string | null;
  settings: RunSettings;
  /** The passages given to the RAG run. The baseline run was given none. */
  evidence: EvidencePassage[];
  baseline: ReportVariant;
  rag: ReportVariant;
  evaluation: ReportEvaluation;
  warnings: string[];
}

export type ReportJobState = 'idle' | 'running' | 'succeeded' | 'failed';

export interface ReportJobStatus {
  state: ReportJobState;
  /** What the job is doing now, while running. */
  step: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}
