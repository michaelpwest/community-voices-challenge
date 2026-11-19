import type { HealthResponse } from '../../src/shared/health';

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  let response: Response;
  try {
    response = await fetch('/api/health', { signal });
  } catch {
    throw new Error('The API is not reachable. Start it with "npm start" (or "npm run api").');
  }
  if (!response.ok) {
    throw new Error(`The API is not responding correctly (HTTP ${response.status}). Is it running?`);
  }
  return (await response.json()) as HealthResponse;
}
