import { serve } from '@hono/node-server';
import { ConfigError, loadConfig, loadEnvFile } from '../config/config';
import { buildEmbeddingMap } from '../embeddings/embeddingMap';
import { runIngestion } from '../ingestion/ingestService';
import { createOllamaGenerator } from '../ollama/chat';
import { createOllamaEmbedder } from '../ollama/embeddings';
import { checkOllama } from '../ollama/ollamaStatus';
import { generateReportRun } from '../reports/reportService';
import { retrieveDiscussions } from '../retrieval/retrieval';
import { LOOPBACK_HOST, SHUTDOWN_MESSAGE } from '../shared/processProtocol';
import { LemmyClient } from '../sources/lemmy/lemmyClient';
import { LemmySource } from '../sources/lemmy/lemmySource';
import { checkDatabase, openDatabase } from '../storage/database';
import { getDataStatus } from '../storage/discussionStore';
import { getRetrievalStats } from '../storage/insightStore';
import { getLatestReportRun } from '../storage/reportStore';
import { createApp } from './app';

function start(): void {
  loadEnvFile();
  const config = loadConfig();
  const { community } = config.source;

  const db = openDatabase(config.databasePath);
  const embedder = createOllamaEmbedder(config.ollama);
  const generator = createOllamaGenerator(config.ollama);
  const source = new LemmySource(new LemmyClient(config.source), config.source);

  const app = createApp({
    config,
    checkOllama: () => checkOllama(config.ollama),
    checkDatabase: () => checkDatabase(config.databasePath),
    getDataStatus: () => getDataStatus(db, community, embedder.model),
    ingest: () => runIngestion({ db, source, embedder, community }),
    search: (query, topK) => retrieveDiscussions({ db, embedder, community }, { query, topK }),
    generateReports: (onStep) =>
      generateReportRun({
        db,
        embedder,
        generator,
        community,
        communityUrl: `${config.source.instanceUrl}/c/${community}`,
        numCtx: config.ollama.numCtx,
        onStep,
      }),
    getLatestReport: () => getLatestReportRun(db, community),
    getEmbeddingMap: () => buildEmbeddingMap({ db, community, embeddingModel: embedder.model }),
    getRetrievalStats: (limit) => getRetrievalStats(db, community, limit),
  });

  const server = serve({ fetch: app.fetch, port: config.apiPort, hostname: LOOPBACK_HOST }, (info) => {
    console.log(`API listening on http://localhost:${info.port}`);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    const reason =
      error.code === 'EADDRINUSE'
        ? `Port ${config.apiPort} is already in use. Stop the other process or change API_PORT in .env.`
        : error.message;
    console.error(`API failed to start: ${reason}`);
    process.exit(1);
  });

  const exit = (): never => {
    // Release the database file so the launcher can delete it on "Clear data".
    if (db.isOpen) db.close();
    process.exit(0);
  };
  const shutdown = (): void => {
    server.close(exit);
    // Do not let an open keep-alive connection hold the process open.
    setTimeout(exit, 2000).unref();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  // Stop when the launcher asks, or when the launcher itself goes away.
  process.once('disconnect', shutdown);
  process.on('message', (message) => {
    if (message === SHUTDOWN_MESSAGE) shutdown();
  });
}

try {
  start();
} catch (error) {
  const reason = error instanceof ConfigError || error instanceof Error ? error.message : String(error);
  console.error(`API failed to start: ${reason}`);
  process.exit(1);
}
