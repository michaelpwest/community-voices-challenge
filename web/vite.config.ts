import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
// Explicit .ts extensions keep this file loadable by Vite's native config loader.
import { loadConfig, loadEnvFile } from '../src/config/config.ts';
import { LOOPBACK_HOST } from '../src/shared/processProtocol.ts';

const WEB_ROOT = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig(() => {
  loadEnvFile(REPO_ROOT);
  const config = loadConfig(process.env, REPO_ROOT);
  return {
    root: WEB_ROOT,
    plugins: [react(), tailwindcss()],
    server: {
      host: LOOPBACK_HOST,
      port: config.webPort,
      strictPort: true,
      // The browser calls /api on the web origin; Vite forwards it to the API.
      proxy: { '/api': `http://${LOOPBACK_HOST}:${config.apiPort}` },
    },
  };
});
