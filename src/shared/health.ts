// Response types shared by the API, the launcher, and the web UI.
// Type-only imports keep this file usable by the browser build.

import type { DataStatus } from './discussions';

export type ModelRole = 'generation' | 'embedding';

export interface ModelStatus {
  name: string;
  role: ModelRole;
  available: boolean;
}

export interface OllamaStatus {
  url: string;
  reachable: boolean;
  version: string | null;
  models: ModelStatus[];
  error: string | null;
}

export interface DatabaseStatus {
  path: string;
  ok: boolean;
  vectorExtensionVersion: string | null;
  error: string | null;
}

export interface SourceInfo {
  instanceUrl: string;
  community: string;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  checkedAt: string;
  database: DatabaseStatus;
  ollama: OllamaStatus;
  source: SourceInfo;
  /** Null when the stored data could not be read. */
  data: DataStatus | null;
}

export interface ApiErrorResponse {
  error: { code: string; message: string };
}
