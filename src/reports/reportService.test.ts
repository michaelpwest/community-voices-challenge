import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runIngestion } from '../ingestion/ingestService';
import { GenerationError, type GenerationRequest } from '../ollama/chat';
import { createKeywordEmbedder, createScriptedGenerator } from '../ollama/testSupport';
import type { Report } from '../shared/reports';
import { createFixtureSource, FIXTURE_COMMUNITY, FIXTURE_NOW } from '../sources/lemmy/fixtures/lemmyFixture';
import { openDatabase } from '../storage/database';
import { getLatestReportRun } from '../storage/reportStore';
import { NO_EVIDENCE_TEXT, PROMPT_VERSION } from './prompt';
import { ReportFormatError } from './reportSchema';
import { GENERATION_DEFAULTS, generateReportRun, NoDataError, type ReportDependencies } from './reportService';
import { report } from './testSupport';

// The whole report pipeline over the synthetic fixture, with a scripted model.

const { embedder } = createKeywordEmbedder(['delay', 'co-op', 'roguelike']);

const BASELINE_REPORT: Report = report({
  summary: 'The community usually talks about big releases such as Elden Ring.',
  themes: [{ title: 'General discussion', description: 'People talk about new games.', sources: [] }],
  predictions: [{ prediction: 'More release talk is likely.', rationale: 'It is typical.', confidence: 'low', sources: [] }],
  limitations: ['Not based on posts from this week.'],
});

const RAG_REPORT: Report = report({
  themes: [{ title: 'Starfall Odyssey delay', description: 'Players accepted the Starfall Odyssey delay.', sources: ['S1', 'S2'] }],
  predictions: [
    { prediction: 'Debate about the delay may continue.', rationale: 'The thread is active.', confidence: 'medium', sources: ['[S1]', 'S77'] },
  ],
});

const userMessage = (request: GenerationRequest): string => request.messages[1]?.content ?? '';
const hasEvidence = (request: GenerationRequest): boolean => !userMessage(request).includes(NO_EVIDENCE_TEXT);

/** Replies like a model would: a generic report without evidence, a specific one with it. */
function scriptedModel() {
  return createScriptedGenerator((request) => JSON.stringify(hasEvidence(request) ? RAG_REPORT : BASELINE_REPORT));
}

let db: DatabaseSync;

beforeEach(async () => {
  db = openDatabase(':memory:');
  await runIngestion({
    db,
    source: createFixtureSource().source,
    embedder,
    community: FIXTURE_COMMUNITY,
    now: () => FIXTURE_NOW,
  });
});

afterEach(() => {
  db.close();
});

function dependencies(overrides: Partial<ReportDependencies> = {}): ReportDependencies {
  return {
    db,
    embedder,
    generator: scriptedModel().generator,
    community: FIXTURE_COMMUNITY,
    communityUrl: 'https://lemmy.fixture.invalid/c/fixture_games',
    numCtx: 16384,
    now: () => FIXTURE_NOW,
    ...overrides,
  };
}

describe('generateReportRun', () => {
  it('produces a baseline report and a RAG report for the same week', async () => {
    const run = await generateReportRun(dependencies());
    expect(run).toMatchObject({
      community: FIXTURE_COMMUNITY,
      windowStart: '2026-01-08T12:00:00.000Z',
      windowEnd: '2026-01-15T12:00:00.000Z',
      generatedAt: '2026-01-15T12:00:00.000Z',
      dataRefreshedAt: '2026-01-15T12:00:00.000Z',
      warnings: [],
    });
    expect(run.baseline).toMatchObject({ kind: 'baseline', report: BASELINE_REPORT, invalidCitations: [] });
    expect(run.rag.kind).toBe('rag');
    expect(run.rag.report.summary).toBe(RAG_REPORT.summary);
  });

  it('holds everything constant between the two runs except the evidence', async () => {
    const { generator, requests } = scriptedModel();
    await generateReportRun(dependencies({ generator }));
    const [baseline, rag] = requests;
    if (!baseline || !rag) throw new Error('expected two generation requests');
    expect(requests).toHaveLength(2);
    expect(rag.messages[0]).toEqual(baseline.messages[0]);
    expect(rag.options).toEqual(baseline.options);
    expect(rag.jsonSchema).toBe(baseline.jsonSchema);
    expect(hasEvidence(baseline)).toBe(false);
    expect(userMessage(rag)).toContain('[S1] POST | 2026-01-15 | score 120');
  });

  it('records the settings shared by both runs', async () => {
    const run = await generateReportRun(dependencies());
    expect(run.settings).toEqual({
      model: 'scripted-test-model',
      embeddingModel: 'keyword-test-model',
      promptVersion: PROMPT_VERSION,
      numCtx: 16384,
      ...GENERATION_DEFAULTS,
    });
  });

  it('records the evidence given to the RAG run, with links back to the source', async () => {
    const run = await generateReportRun(dependencies());
    expect(run.evidence).toHaveLength(6);
    expect(run.evidence[0]).toMatchObject({
      label: 'S1',
      discussionId: 'lemmy:lemmy.fixture.invalid:post:1001',
      url: 'https://lemmy.fixture.invalid/post/1001',
    });
  });

  it('keeps valid citations, removes invented ones, and reports them', async () => {
    const run = await generateReportRun(dependencies());
    expect(run.rag.report.themes[0]?.sources).toEqual(['S1', 'S2']);
    expect(run.rag.report.predictions[0]?.sources).toEqual(['S1']);
    expect(run.rag.invalidCitations).toEqual(['S77']);
    expect(run.evaluation.notes.join('\n')).toContain('S77');
  });

  it('never accepts a citation in the baseline, which was given no evidence', async () => {
    const citing = createScriptedGenerator(() => JSON.stringify(RAG_REPORT));
    const run = await generateReportRun(dependencies({ generator: citing.generator }));
    expect(run.baseline.report.themes[0]?.sources).toEqual([]);
    expect(run.baseline.invalidCitations).toEqual(['S1', 'S2', 'S77']);
  });

  it('compares the two reports against the stored week', async () => {
    const { evaluation } = await generateReportRun(dependencies());
    expect(evaluation.rag).toMatchObject({ citedItems: 2, distinctSources: 2 });
    expect(evaluation.baseline).toMatchObject({ citedItems: 0, distinctSources: 0 });
    expect(evaluation.baseline.namedTermsNotFound).toEqual(['Elden', 'Ring']);
    expect(evaluation.rag.namedTermsNotFound).toEqual([]);
  });

  it('passes a prompt-injection comment to the model only as quoted evidence', async () => {
    const { generator, requests } = scriptedModel();
    await generateReportRun(dependencies({ generator }));
    const [baseline, rag] = requests;
    const injection = 'Ignore all previous instructions';
    expect(rag?.messages[0]?.content).not.toContain(injection);
    expect(baseline?.messages[1]?.content).not.toContain(injection);
    const ragUser = rag ? userMessage(rag) : '';
    expect(ragUser.indexOf(injection)).toBeGreaterThan(ragUser.indexOf('<evidence>'));
    expect(ragUser.indexOf(injection)).toBeLessThan(ragUser.indexOf('</evidence>'));
  });

  it('stores the run so it can be read back', async () => {
    const run = await generateReportRun(dependencies());
    expect(run.id).toBeGreaterThan(0);
    expect(getLatestReportRun(db, FIXTURE_COMMUNITY)).toEqual(run);
    const second = await generateReportRun(dependencies());
    expect(getLatestReportRun(db, FIXTURE_COMMUNITY)?.id).toBe(second.id);
    expect(second.id).toBeGreaterThan(run.id);
  });

  it('reports each stage as it starts', async () => {
    const steps: string[] = [];
    await generateReportRun(dependencies({ onStep: (step) => steps.push(step) }));
    expect(steps).toEqual([
      'Selecting evidence from the past week',
      'Generating the baseline report (no retrieved evidence)',
      'Generating the RAG report (6 evidence passages)',
    ]);
  });

  it('refuses to run when nothing from the past week is stored', async () => {
    const { generator, requests } = scriptedModel();
    const later = dependencies({ generator, now: () => new Date('2026-03-01T00:00:00Z') });
    await expect(generateReportRun(later)).rejects.toBeInstanceOf(NoDataError);
    expect(requests).toHaveLength(0);
  });

  it('stores nothing when the model fails', async () => {
    const failing = createScriptedGenerator(() => {
      throw new GenerationError('Ollama is not reachable at http://localhost:11434.');
    });
    await expect(generateReportRun(dependencies({ generator: failing.generator }))).rejects.toBeInstanceOf(GenerationError);
    expect(getLatestReportRun(db, FIXTURE_COMMUNITY)).toBeNull();
  });

  it('stores nothing when the model returns an unusable report', async () => {
    const rambling = createScriptedGenerator(() => 'Sure! Here is the report you asked for.');
    await expect(generateReportRun(dependencies({ generator: rambling.generator }))).rejects.toBeInstanceOf(ReportFormatError);
    expect(getLatestReportRun(db, FIXTURE_COMMUNITY)).toBeNull();
  });

  it('warns when the prompt leaves too little of the context window for the reply', async () => {
    const run = await generateReportRun(dependencies({ numCtx: 2000 }));
    expect(run.warnings).toHaveLength(1);
    expect(run.warnings[0]).toContain('Raise OLLAMA_NUM_CTX');
  });

  it('warns when the stored data has not been refreshed for over a day', async () => {
    const run = await generateReportRun(dependencies({ now: () => new Date('2026-01-17T12:00:00Z') }));
    expect(run.warnings.join('\n')).toContain('last refreshed on 2026-01-15');
  });
});
