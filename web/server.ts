import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { SHUTDOWN_MESSAGE } from '../src/shared/processProtocol';

// Starts the web UI (Vite dev server). Used by `npm run web` and by the launcher.

async function start(): Promise<void> {
  const server = await createServer({
    configFile: fileURLToPath(new URL('./vite.config.ts', import.meta.url)),
    logLevel: 'warn',
  });
  await server.listen();
  console.log(`Web UI listening on http://localhost:${server.config.server.port}`);

  const shutdown = (): void => {
    void server.close().finally(() => process.exit(0));
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

start().catch((error: unknown) => {
  console.error(`Web UI failed to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
