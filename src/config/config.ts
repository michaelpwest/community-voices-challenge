import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

export interface AppConfig {
  webPort: number;
  apiPort: number;
  ollama: {
    url: string;
    model: string;
    embedModel: string;
    numCtx: number;
  };
  databasePath: string;
  source: {
    instanceUrl: string;
    community: string;
    userAgent: string;
    commentsPerPost: number;
  };
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

const port = z.coerce.number().int().min(1).max(65535);
const name = z.string().trim().min(1);
const httpUrl = z
  .string()
  .trim()
  .refine(isHttpUrl, 'must be an http:// or https:// URL')
  .transform((value) => value.replace(/\/+$/, ''));

const envSchema = z.object({
  WEB_PORT: port.default(3000),
  API_PORT: port.default(3001),
  OLLAMA_URL: httpUrl.default('http://localhost:11434'),
  OLLAMA_MODEL: name.default('llama3.1:8b'),
  OLLAMA_EMBED_MODEL: name.default('nomic-embed-text'),
  OLLAMA_NUM_CTX: z.coerce.number().int().min(512).default(16384),
  DATABASE_PATH: name.default('./data/community-voices.db'),
  LEMMY_INSTANCE_URL: httpUrl.default('https://lemmy.world'),
  LEMMY_COMMUNITY: name.default('games'),
  LEMMY_USER_AGENT: name.default('community-voices/0.1 (local weekly community report demo)'),
  // Lemmy returns at most 50 items per request.
  LEMMY_COMMENTS_PER_POST: z.coerce.number().int().min(0).max(50).default(10),
});

type EnvKey = keyof z.infer<typeof envSchema>;
const ENV_KEYS = Object.keys(envSchema.shape) as EnvKey[];

/** Blank values (e.g. `API_PORT=`) count as unset so defaults apply. */
function pickConfiguredValues(env: NodeJS.ProcessEnv): Partial<Record<EnvKey, string>> {
  const picked: Partial<Record<EnvKey, string>> = {};
  for (const key of ENV_KEYS) {
    const value = env[key];
    if (value !== undefined && value.trim() !== '') picked[key] = value;
  }
  return picked;
}

/** Validates environment variables and returns typed settings, or throws ConfigError. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, baseDir = process.cwd()): AppConfig {
  const parsed = envSchema.safeParse(pickConfiguredValues(env));
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
  }
  const values = parsed.data;
  if (values.WEB_PORT === values.API_PORT) {
    throw new ConfigError([`WEB_PORT and API_PORT must differ (both are ${values.API_PORT})`]);
  }
  return {
    webPort: values.WEB_PORT,
    apiPort: values.API_PORT,
    ollama: {
      url: values.OLLAMA_URL,
      model: values.OLLAMA_MODEL,
      embedModel: values.OLLAMA_EMBED_MODEL,
      numCtx: values.OLLAMA_NUM_CTX,
    },
    databasePath: resolve(baseDir, values.DATABASE_PATH),
    source: {
      instanceUrl: values.LEMMY_INSTANCE_URL,
      community: values.LEMMY_COMMUNITY,
      userAgent: values.LEMMY_USER_AGENT,
      commentsPerPost: values.LEMMY_COMMENTS_PER_POST,
    },
  };
}

/**
 * Loads `.env` from baseDir into process.env. Variables that are already set
 * win, so a parent process can override individual values.
 * Returns false when no `.env` file exists.
 */
export function loadEnvFile(baseDir = process.cwd()): boolean {
  const envPath = resolve(baseDir, '.env');
  if (!existsSync(envPath)) return false;
  process.loadEnvFile(envPath);
  return true;
}
