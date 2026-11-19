// Response types shared by the API, the launcher, and the web UI.
// Keep this file free of imports so the browser build can use it.

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
}

export interface ApiErrorResponse {
  error: { code: string; message: string };
}
