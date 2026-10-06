import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CONFIG_KEYS, DEFAULT_BASE_URL } from './utils/constants.js';

export interface CliConfig {
  baseUrl: string;
  apiKey?: string;
  model?: string;
}

export type ConfigKey = (typeof CONFIG_KEYS)[number];

type Env = Record<string, string | undefined>;

export function configPath(env: Env = process.env): string {
  const base = env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(base, 'llm-gateway', 'config.json');
}

export function readConfigFile(path: string): Partial<CliConfig> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Partial<CliConfig>;
  } catch {
    throw new Error(`Config file is not valid JSON: ${path}`);
  }
}

/** Precedence: environment variables > config file > defaults. */
export function loadConfig(env: Env = process.env, path = configPath(env)): CliConfig {
  const file = readConfigFile(path);
  return {
    baseUrl: (env.LLM_BASE_URL ?? file.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
    apiKey: env.LLM_API_KEY ?? file.apiKey,
    model: env.LLM_MODEL ?? file.model,
  };
}

export function saveConfigValue(key: ConfigKey, value: string, path = configPath()): void {
  const current = readConfigFile(path);
  const next = { ...current, [key]: key === 'baseUrl' ? value.replace(/\/+$/, '') : value };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  chmodSync(path, 0o600); // the file holds an API key
}

export function maskKey(key?: string): string {
  if (!key) return '(not set)';
  return key.length <= 10 ? '****' : `${key.slice(0, 6)}…${key.slice(-4)}`;
}
