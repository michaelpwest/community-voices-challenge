import type { DatabaseSync } from 'node:sqlite';
import type { GenerationOptions, TextGenerator } from '../ollama/chat';
import type { Embedder } from '../ollama/embeddings';
import type { EvidencePassage, ReportRun, ReportVariant, ReportVariantKind } from '../shared/reports';
import { lastSevenDays, type TimeWindow } from '../shared/time';
import { getDataStatus, listDiscussionsInWindow } from '../storage/discussionStore';
import { saveReportRun } from '../storage/reportStore';
import { resolveCitations } from './citations';
import { evaluateReports } from './evaluation';
import { selectEvidence } from './evidence';
import { buildReportMessages, PROMPT_VERSION } from './prompt';
import { parseReport, reportJsonSchema } from './reportSchema';

export interface ReportDependencies {
  db: DatabaseSync;
  embedder: Embedder;
  generator: TextGenerator;
  community: string;
  communityUrl: string;
  numCtx: number;
  now?: () => Date;
  /** Called as the run moves from one stage to the next. */
  onStep?: (step: string) => void;
}

/**
 * Sampling settings for both runs. A low temperature and a fixed seed reduce
 * run-to-run variation (they do not remove it entirely), so differences
 * between the two reports come mainly from the evidence.
 */
export const GENERATION_DEFAULTS = { temperature: 0.2, seed: 42, maxOutputTokens: 2500 };

/** There is nothing from the past week to report on. */
export class NoDataError extends Error {
  constructor() {
    super('No discussions from the past seven days are stored. Refresh the feed first.');
    this.name = 'NoDataError';
  }
}

/**
 * Generates the baseline and RAG reports and compares them.
 *
 * Both runs go through the same code path with the same model, system prompt,
 * report period, and sampling settings. The only difference is the evidence
 * list: empty for the baseline, retrieved passages for RAG.
 *
 * Throws NoDataError, EmbeddingError, GenerationError, or ReportFormatError.
 */
export async function generateReportRun(dependencies: ReportDependencies): Promise<ReportRun> {
  const { db, embedder, generator, community, communityUrl, numCtx, now = () => new Date(), onStep } = dependencies;
  const window = lastSevenDays(now());
  const weekDiscussions = listDiscussionsInWindow(db, community, window);
  if (weekDiscussions.length === 0) throw new NoDataError();

  const options: GenerationOptions = { numCtx, ...GENERATION_DEFAULTS };

  async function generateVariant(kind: ReportVariantKind, evidence: EvidencePassage[]): Promise<ReportVariant> {
    const messages = buildReportMessages({ community, communityUrl, window, evidence });
    const result = await generator.generate({ messages, jsonSchema: reportJsonSchema, options });
    const { report, invalidCitations } = resolveCitations(parseReport(result.text), evidence);
    return {
      kind,
      report,
      invalidCitations,
      durationMs: result.durationMs,
      promptTokens: result.promptTokens,
      outputTokens: result.outputTokens,
    };
  }

  onStep?.('Selecting evidence from the past week');
  const evidence = await selectEvidence({ db, embedder, community }, window);
  onStep?.('Generating the baseline report (no retrieved evidence)');
  const baseline = await generateVariant('baseline', []);
  onStep?.(`Generating the RAG report (${evidence.length} evidence passages)`);
  const rag = await generateVariant('rag', evidence);

  const data = getDataStatus(db, community, embedder.model);
  return saveReportRun(db, {
    community,
    windowStart: window.start.toISOString(),
    windowEnd: window.end.toISOString(),
    generatedAt: now().toISOString(),
    dataRefreshedAt: data.lastIngestion?.finishedAt ?? null,
    settings: {
      model: generator.model,
      embeddingModel: embedder.model,
      promptVersion: PROMPT_VERSION,
      ...options,
    },
    evidence,
    baseline,
    rag,
    evaluation: evaluateReports(baseline, rag, weekDiscussions),
    warnings: collectWarnings(rag, options, data.posts + data.comments - data.embedded, window, data.lastIngestion?.finishedAt),
  });
}

function collectWarnings(
  rag: ReportVariant,
  options: GenerationOptions,
  unembedded: number,
  window: TimeWindow,
  dataRefreshedAt: string | undefined,
): string[] {
  const warnings: string[] = [];
  if (rag.promptTokens !== null && rag.promptTokens + options.maxOutputTokens > options.numCtx) {
    warnings.push(
      `The RAG prompt used ${rag.promptTokens} tokens of a ${options.numCtx}-token context, leaving too little room for the reply; some evidence may have been cut off. Raise OLLAMA_NUM_CTX.`,
    );
  }
  if (unembedded > 0) {
    warnings.push(`${unembedded} stored discussions have no embedding and could not be found by similarity search.`);
  }
  const dayMs = 24 * 60 * 60 * 1000;
  if (dataRefreshedAt && window.end.getTime() - Date.parse(dataRefreshedAt) > dayMs) {
    warnings.push(`The community data was last refreshed on ${dataRefreshedAt.slice(0, 10)}; newer discussions are missing.`);
  }
  return warnings;
}
