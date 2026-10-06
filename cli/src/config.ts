import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CONFIG_KEYS, DEFAULT_BASE_URL } from './utils/constants.js';

export interface CliProfile {
  baseUrl: string;
  apiKey?: string;
  model?: string;
}

export interface CliConfig {
  baseUrl: string;
  apiKey?: string;
  model?: string;
  currentProfile?: string;
}

interface StoredConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;

  currentProfile?: string;
  profiles?: Record<string, CliProfile>;
}

export type ConfigKey = (typeof CONFIG_KEYS)[number];

type Env = Record<string, string | undefined>;

export function configPath(env: Env = process.env): string {
  const base = env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(base, 'llm-gateway', 'config.json');
}

export function readConfigFile(path: string): StoredConfig {
  if (!existsSync(path)) return {};

  try {
    return JSON.parse(readFileSync(path, 'utf8')) as StoredConfig;
  } catch {
    throw new Error(`Config file is not valid JSON: ${path}`);
  }
}

function normalizeProfile(profile: Partial<CliProfile>): CliProfile {
  return {
    baseUrl: (profile.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
    apiKey: profile.apiKey,
    model: profile.model,
  };
}

function writeConfig(file: StoredConfig, path: string): void {
  mkdirSync(dirname(path), { recursive: true });

  writeFileSync(
    path,
    JSON.stringify(file, null, 2) + '\n',
    { mode: 0o600 },
  );

  chmodSync(path, 0o600);
}

/**
 * Returns the effective config.
 *
 * Environment variables always override profile/file values.
 *
 * If profiles exist, the current profile is used.
 * Otherwise legacy flat config remains supported.
 */
export function loadConfig(
  env: Env = process.env,
  path = configPath(env),
): CliConfig {
  const file = readConfigFile(path);

  let baseUrl = file.baseUrl ?? DEFAULT_BASE_URL;
  let apiKey = file.apiKey;
  let model = file.model;

  let currentProfile = file.currentProfile;

  if (
    currentProfile &&
    file.profiles &&
    file.profiles[currentProfile]
  ) {
    const profile = normalizeProfile(file.profiles[currentProfile]);

    baseUrl = profile.baseUrl;
    apiKey = profile.apiKey;
    model = profile.model;
  }

  return {
    baseUrl: (env.LLM_BASE_URL ?? baseUrl).replace(/\/+$/, ''),
    apiKey: env.LLM_API_KEY ?? apiKey,
    model: env.LLM_MODEL ?? model,
    currentProfile,
  };
}

/**
 * Save a normal config value.
 *
 * If profiles are enabled, the value is saved to the active profile.
 * Otherwise it uses the existing flat config format.
 */
export function saveConfigValue(
  key: ConfigKey,
  value: string,
  path = configPath(),
): void {
  const file = readConfigFile(path);

  if (
    file.profiles &&
    file.currentProfile &&
    file.profiles[file.currentProfile]
  ) {
    const current = normalizeProfile(file.profiles[file.currentProfile]);

    file.profiles[file.currentProfile] = {
      ...current,
      [key]: key === 'baseUrl'
        ? value.replace(/\/+$/, '')
        : value,
    };
  } else {
    const next = {
      ...file,
      [key]: key === 'baseUrl'
        ? value.replace(/\/+$/, '')
        : value,
    };

    writeConfig(next, path);
    return;
  }

  writeConfig(file, path);
}

function migrateLegacyToProfiles(
  file: StoredConfig,
): StoredConfig {
  if (file.profiles) return file;

  const defaultProfile: CliProfile = {
    baseUrl: (file.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
    apiKey: file.apiKey,
    model: file.model,
  };

  const {
    baseUrl: _baseUrl,
    apiKey: _apiKey,
    model: _model,
    ...rest
  } = file;

  return {
    ...rest,
    currentProfile: 'default',
    profiles: {
      default: defaultProfile,
    },
  };
}

export function addProfile(
  name: string,
  profile: CliProfile,
  path = configPath(),
): void {
  const file = migrateLegacyToProfiles(readConfigFile(path));

  if (!file.profiles) {
    file.profiles = {};
  }

  if (file.profiles[name]) {
    throw new Error(`Profile "${name}" already exists.`);
  }

  file.profiles[name] = normalizeProfile(profile);

  if (!file.currentProfile) {
    file.currentProfile = name;
  }

  writeConfig(file, path);
}

export function useProfile(
  name: string,
  path = configPath(),
): void {
  const file = readConfigFile(path);

  if (!file.profiles || !file.profiles[name]) {
    throw new Error(`Profile "${name}" does not exist.`);
  }

  file.currentProfile = name;

  writeConfig(file, path);
}

export function listProfiles(
  path = configPath(),
): {
  name: string;
  active: boolean;
  profile: CliProfile;
}[] {
  const file = readConfigFile(path);

  if (!file.profiles) {
    return [];
  }

  return Object.entries(file.profiles).map(([name, profile]) => ({
    name,
    active: name === file.currentProfile,
    profile: normalizeProfile(profile),
  }));
}

export function removeProfile(
  name: string,
  path = configPath(),
): void {
  const file = readConfigFile(path);

  if (!file.profiles || !file.profiles[name]) {
    throw new Error(`Profile "${name}" does not exist.`);
  }

  delete file.profiles[name];

  if (file.currentProfile === name) {
    const next = Object.keys(file.profiles);

    if (next.length === 0) {
      file.currentProfile = undefined;
    } else {
      file.currentProfile = next[0];
    }
  }

  writeConfig(file, path);
}

export function maskKey(key?: string): string {
  if (!key) return '(not set)';
  return key.length <= 10
    ? '****'
    : `${key.slice(0, 6)}…${key.slice(-4)}`;
}
