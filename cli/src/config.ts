import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CONFIG_KEYS, DEFAULT_BASE_URL, PROFILE_RE } from './utils/constants.js';

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
  /** Which values were replaced by environment variables (only present when non-empty). */
  overrides?: ConfigKey[];
  /**
   * Set when LLM_BASE_URL points at a different gateway than the saved one and no
   * LLM_API_KEY was given: the saved key is deliberately NOT used, so it is never
   * sent to a server it was not created for. Holds the URL that was requested.
   */
  keyWithheldFor?: string;
  /** Set when the config cannot be used as-is (for example the active profile was deleted). */
  profileProblem?: string;
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

/** Names that would collide with object internals if used as a key. */
const RESERVED_PROFILE_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

export function configPath(env: Env = process.env): string {
  const base = env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(base, 'llm-gateway', 'config.json');
}

const hasOwn = (obj: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key);

function hasProfile(file: StoredConfig, name: string): boolean {
  return !!file.profiles && hasOwn(file.profiles, name);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function readConfigFile(path: string): StoredConfig {
  if (!existsSync(path)) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`Config file is not valid JSON: ${path}`);
  }

  if (!isPlainObject(parsed)) {
    throw new Error(`Config file must contain a JSON object: ${path}`);
  }
  if (parsed.profiles !== undefined && !isPlainObject(parsed.profiles)) {
    throw new Error(`"profiles" in the config file must be an object: ${path}`);
  }
  return parsed as StoredConfig;
}

function stripTrailingSlashes(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** Accepts only http(s) URLs, so "localhost:3000" (no scheme) is rejected early. */
function assertGatewayUrl(url: string): string {
  const cleaned = stripTrailingSlashes(url);
  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    throw new Error(`"${url}" is not a valid URL. Include the scheme, e.g. http://localhost:3000`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`"${url}" must start with http:// or https://`);
  }
  return cleaned;
}

/** True when two gateway URLs point at the same place (case-insensitive host, no trailing slash). */
function sameGateway(a: string, b: string): boolean {
  try {
    const ua = new URL(stripTrailingSlashes(a));
    const ub = new URL(stripTrailingSlashes(b));
    return (
      ua.origin.toLowerCase() === ub.origin.toLowerCase() &&
      ua.pathname.replace(/\/+$/, '') === ub.pathname.replace(/\/+$/, '')
    );
  } catch {
    return stripTrailingSlashes(a) === stripTrailingSlashes(b);
  }
}

function normalizeProfile(profile: Partial<CliProfile>): CliProfile {
  return {
    baseUrl: stripTrailingSlashes(profile.baseUrl ?? DEFAULT_BASE_URL),
    apiKey: profile.apiKey,
    model: profile.model,
  };
}

export function validateProfileName(name: string): void {
  if (!PROFILE_RE.test(name)) {
    throw new Error(
      'Profile name must start with a letter/number and contain only letters, numbers, ".", "_" or "-".',
    );
  }
  if (RESERVED_PROFILE_NAMES.has(name)) {
    throw new Error(`"${name}" is a reserved name. Pick another profile name.`);
  }
}

/**
 * Writes the config atomically with owner-only permissions: the new content goes to
 * a temp file in the same directory (created 0600), is flushed to disk, then renamed
 * over the old file. A crash can leave a stray temp file but never a half-written config.
 */
function writeConfig(file: StoredConfig, path: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const tmp = join(dir, `.config.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  const data = JSON.stringify(file, null, 2) + '\n';

  try {
    const fd = openSync(tmp, 'wx', 0o600);
    try {
      writeSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      // temp file already gone; nothing to clean up
    }
    throw e;
  }

  chmodSync(path, 0o600);
}

/**
 * Returns the effective config.
 *
 * Environment variables override profile/file values, with one safety rule: if
 * LLM_BASE_URL points at a different gateway than the saved one and LLM_API_KEY is
 * not set, the saved key is withheld (see `keyWithheldFor`).
 *
 * If an active profile is set it is used; if it names a profile that no longer
 * exists, the saved flat credentials are NOT used as a fallback (see `profileProblem`).
 * With no active profile, the legacy flat settings apply.
 */
export function loadConfig(
  env: Env = process.env,
  path = configPath(env),
): CliConfig {
  const file = readConfigFile(path);

  let baseUrl = file.baseUrl ?? DEFAULT_BASE_URL;
  let apiKey = file.apiKey;
  let model = file.model;
  let profileProblem: string | undefined;

  const currentProfile = file.currentProfile;

  if (currentProfile) {
    if (hasProfile(file, currentProfile)) {
      const profile = normalizeProfile(file.profiles![currentProfile]!);
      baseUrl = profile.baseUrl;
      apiKey = profile.apiKey;
      model = profile.model;
    } else {
      profileProblem =
        `The active profile "${currentProfile}" no longer exists. ` +
        'Run "llm profile list" to see what is saved, then "llm profile use <name>".';
      baseUrl = DEFAULT_BASE_URL;
      apiKey = undefined;
      model = undefined;
    }
  }

  const overrides: ConfigKey[] = [];

  const envBase = env.LLM_BASE_URL?.trim() ? stripTrailingSlashes(env.LLM_BASE_URL) : undefined;
  let finalBase = stripTrailingSlashes(baseUrl);
  let keyWithheldFor: string | undefined;
  if (envBase !== undefined) {
    if (!sameGateway(envBase, finalBase)) {
      overrides.push('baseUrl');
      if (!env.LLM_API_KEY && apiKey) {
        keyWithheldFor = envBase;
        apiKey = undefined;
      }
    }
    finalBase = envBase;
  }

  if (env.LLM_API_KEY) {
    apiKey = env.LLM_API_KEY;
    overrides.push('apiKey');
  }

  if (env.LLM_MODEL) {
    model = env.LLM_MODEL;
    overrides.push('model');
  }

  return {
    baseUrl: finalBase,
    apiKey,
    model,
    currentProfile,
    overrides: overrides.length > 0 ? overrides : undefined,
    keyWithheldFor,
    profileProblem,
  };
}

/**
 * Save a normal config value.
 *
 * If an active profile is set, the value is saved to that profile.
 * Otherwise it uses the legacy flat config format.
 */
export function saveConfigValue(
  key: ConfigKey,
  value: string,
  path = configPath(),
): void {
  const file = readConfigFile(path);
  const next = key === 'baseUrl' ? assertGatewayUrl(value) : value;

  if (file.currentProfile) {
    if (!hasProfile(file, file.currentProfile)) {
      throw new Error(
        `The active profile "${file.currentProfile}" no longer exists. ` +
          'Run "llm profile use <name>" first.',
      );
    }
    const current = normalizeProfile(file.profiles![file.currentProfile]!);
    file.profiles![file.currentProfile] = { ...current, [key]: next };
  } else {
    file[key] = next;
  }

  writeConfig(file, path);
}

/**
 * Moves old flat settings into a profile called "default", but only when there is
 * something to move. An empty config stays empty: no phantom profile is invented.
 */
function migrateLegacyToProfiles(
  file: StoredConfig,
): { file: StoredConfig; migrated: boolean } {
  if (file.profiles) return { file, migrated: false };

  const hasLegacy = Boolean(file.baseUrl || file.apiKey || file.model);
  const { baseUrl, apiKey, model, ...rest } = file;

  if (!hasLegacy) return { file: { ...rest, profiles: {} }, migrated: false };

  return {
    migrated: true,
    file: {
      ...rest,
      currentProfile: 'default',
      profiles: { default: normalizeProfile({ baseUrl, apiKey, model }) },
    },
  };
}

export interface AddProfileResult {
  /** True when earlier flat settings were moved into a profile named "default". */
  migrated: boolean;
  /** The profile that is active after this call. */
  active?: string;
}

export function addProfile(
  name: string,
  profile: CliProfile,
  path = configPath(),
): AddProfileResult {
  validateProfileName(name);
  const baseUrl = assertGatewayUrl(profile.baseUrl);

  const { file, migrated } = migrateLegacyToProfiles(readConfigFile(path));
  const profiles = file.profiles!;

  if (hasOwn(profiles, name)) {
    throw new Error(
      migrated && name === 'default'
        ? 'Profile "default" already exists: it holds your earlier settings. Pick another name.'
        : `Profile "${name}" already exists.`,
    );
  }

  profiles[name] = normalizeProfile({ ...profile, baseUrl });

  if (!file.currentProfile || !hasOwn(profiles, file.currentProfile)) {
    file.currentProfile = name;
  }

  writeConfig(file, path);
  return { migrated, active: file.currentProfile };
}

export function useProfile(
  name: string,
  path = configPath(),
): void {
  const file = readConfigFile(path);

  if (!hasProfile(file, name)) {
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

export interface RemoveProfileResult {
  wasActive: boolean;
  remaining: string[];
}

/**
 * Removes a profile. The active profile is never removed (and never silently
 * replaced) unless it is the only one left or `force` is set; after removing an
 * active profile NO profile is active, and the caller says so.
 */
export function removeProfile(
  name: string,
  path = configPath(),
  opts: { force?: boolean } = {},
): RemoveProfileResult {
  const file = readConfigFile(path);

  if (!hasProfile(file, name)) {
    throw new Error(`Profile "${name}" does not exist.`);
  }

  const wasActive = file.currentProfile === name;
  const total = Object.keys(file.profiles!).length;

  if (wasActive && total > 1 && !opts.force) {
    throw new Error(
      `"${name}" is the active profile. Switch first with "llm profile use <name>", ` +
        'or remove it anyway with --force (no profile will be active afterwards).',
    );
  }

  delete file.profiles![name];
  if (wasActive) delete file.currentProfile;

  const remaining = Object.keys(file.profiles!);
  if (remaining.length === 0) delete file.profiles;

  writeConfig(file, path);
  return { wasActive, remaining };
}

export function maskKey(key?: string): string {
  if (!key) return '(not set)';
  return key.length <= 10
    ? '****'
    : `${key.slice(0, 6)}…${key.slice(-4)}`;
}
