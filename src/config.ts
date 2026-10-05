import { z } from 'zod';

const Env = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.string().default('info'),
  OLLAMA_URL: z.string().url().default('http://127.0.0.1:11434'),
  REDIS_URL: z.string().optional(), // unset => in-memory rate limiting
  DATABASE_URL: z.string().min(1),
  ALLOWED_MODELS: z.string().default('llama3.2:3b'),
  DEFAULT_MODEL: z.string().default('llama3.2:3b'),
  MAX_CONCURRENCY: z.coerce.number().int().positive().default(1),
  MAX_QUEUE: z.coerce.number().int().nonnegative().default(8),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  MODEL_CONTEXT_TOKENS: z.coerce.number().int().positive().default(4096),
  RESERVE_OUTPUT_TOKENS: z.coerce.number().int().positive().default(800),
  MAX_HISTORY_MESSAGES: z.coerce.number().int().positive().default(100),
  LEASE_SECONDS: z.coerce.number().int().positive().default(180),
});

const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

export function createConfig(env: Record<string, string | undefined> = process.env) {
  const e = Env.parse(env);
  return { ...e, allowedModels: new Set(list(e.ALLOWED_MODELS)) };
}

export type config = ReturnType<typeof createConfig>;