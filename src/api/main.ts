import { serve } from '@hono/node-server';
import { ConfigError, loadConfig, loadEnvFile } from '../config/config';
import { checkOllama } from '../ollama/ollamaStatus';
import { LOOPBACK_HOST, SHUTDOWN_MESSAGE } from '../shared/processProtocol';
import { checkDatabase } from '../storage/database';
import { createApp } from './app';

function start(): void {
  loadEnvFile();
  const config = loadConfig();
  const app = createApp({
    config,
    checkOllama: () => checkOllama(config.ollama),
    checkDatabase: () => checkDatabase(config.databasePath),
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

  const shutdown = (): void => {
    server.close(() => process.exit(0));
    // Do not let an open keep-alive connection hold the process open.
    setTimeout(() => process.exit(0), 2000).unref();
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
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(1);
}
