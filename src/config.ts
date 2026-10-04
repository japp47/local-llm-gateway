import { z } from 'zod';

const Env = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().default(3000),
  OLLAMA_URL: z.string().url().default('http://127.0.0.1:11434'),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  API_KEYS: z.string().min(1),
  ALLOWED_MODELS: z.string().default('llama3.2:3b'),
  MAX_CONCURRENCY: z.coerce.number().int().positive().default(1),
  MAX_QUEUE: z.coerce.number().int().nonnegative().default(8),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
});

const env = (globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
}).process?.env ?? {};

export const config = Env.parse(env);

const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
export const apiKeys = new Set(list(config.API_KEYS));
export const allowedModels = new Set(list(config.ALLOWED_MODELS));