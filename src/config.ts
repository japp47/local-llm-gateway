import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

/** Empty strings count as unset, so `DATABASE_URL= npm run dev` switches to single-user mode. */
const optionalString = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());

const Env = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.string().default('info'),
  OLLAMA_URL: z.string().url().default('http://127.0.0.1:11434'),
  REDIS_URL: optionalString, // unset => in-memory rate limiting
  DATABASE_URL: optionalString, // unset => single-user mode: SQLite in DATA_DIR
  DATA_DIR: optionalString, // unset => the OS's usual place for app data
  // Unset in single-user mode: allowed = what Ollama has installed, default = picked to fit
  // this machine's memory. Unset in server mode: llama3.2:3b, as before.
  ALLOWED_MODELS: optionalString,
  DEFAULT_MODEL: optionalString,
  MAX_CONCURRENCY: z.coerce.number().int().positive().default(1),
  MAX_QUEUE: z.coerce.number().int().nonnegative().default(8),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  MODEL_CONTEXT_TOKENS: z.coerce.number().int().positive().default(4096),
  RESERVE_OUTPUT_TOKENS: z.coerce.number().int().positive().default(800),
  MAX_HISTORY_MESSAGES: z.coerce.number().int().positive().default(100),
  LEASE_SECONDS: z.coerce.number().int().positive().default(180),
  // Extra host names the web page may be reached by (comma-separated), beyond localhost.
  WEB_HOSTS: optionalString,
  // 'wifi': single-user mode also listens on the local network, for paired phones (llm start --phone).
  PHONE_ACCESS: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['off', 'wifi']).default('off')),
});

const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

type Env = Record<string, string | undefined>;

/** Where single-user mode keeps its database, following each OS's convention. */
export function defaultDataDir(
  platform: NodeJS.Platform = process.platform,
  env: Env = process.env,
  home = homedir(),
): string {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'llm-gateway');
  if (platform === 'win32') return join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'llm-gateway');
  return join(env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'llm-gateway');
}

/** Server mode's fallback when the model settings are unset (the pre-auto-pick behaviour). */
export const SERVER_FALLBACK_MODEL = 'llama3.2:3b';

export function createConfig(env: Env = process.env) {
  const e = Env.parse(env);
  /** Chosen by configuration only; the user is never asked. */
  const mode = (e.DATABASE_URL ? 'server' : 'single') as 'server' | 'single';
  const fallback = mode === 'server' ? SERVER_FALLBACK_MODEL : undefined;
  return {
    ...e,
    mode,
    dataDir: e.DATA_DIR ?? defaultDataDir(process.platform, env),
    webHosts: e.WEB_HOSTS ? list(e.WEB_HOSTS) : [],
    /** `undefined` means "discover from Ollama" (single-user mode only). */
    models: {
      allowed: e.ALLOWED_MODELS ? list(e.ALLOWED_MODELS) : fallback ? [fallback] : undefined,
      defaultModel: e.DEFAULT_MODEL ?? fallback,
    },
  };
}

export type config = ReturnType<typeof createConfig>;

/** Where the gateway listens: also on the network when single-user mode has phone access on. */
export function listenHost(c: Pick<config, 'mode' | 'PHONE_ACCESS' | 'HOST'>): string {
  return c.mode === 'single' && c.PHONE_ACCESS === 'wifi' && ['127.0.0.1', 'localhost'].includes(c.HOST) ? '0.0.0.0' : c.HOST;
}