import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addProfile,
  listProfiles,
  loadConfig,
  readConfigFile,
  removeProfile,
  saveConfigValue,
  useProfile,
} from '../src/config.js';
import { profileAddCommand, resolveApiKeyInput } from '../src/commands/profile.js';
import { getClient } from '../src/commands/shared.js';

let dir: string;
let path: string;

const seed = (obj: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj));
};
const onDisk = () => JSON.parse(readFileSync(path, 'utf8'));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'llm-cli-profiles-'));
  path = join(dir, 'nested', 'config.json');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe('adding profiles', () => {
  it('does not invent a "default" profile on an empty config', () => {
    const r = addProfile('personal', { baseUrl: 'http://localhost:3000', apiKey: 'k1' }, path);
    expect(r).toEqual({ migrated: false, active: 'personal' });
    expect(Object.keys(onDisk().profiles)).toEqual(['personal']);
    expect(onDisk().currentProfile).toBe('personal');
  });

  it('moves earlier flat settings into "default" and keeps them active', () => {
    seed({ baseUrl: 'http://old:3000', apiKey: 'old-key', model: 'm1' });
    const r = addProfile('work', { baseUrl: 'http://work:3000', apiKey: 'wk' }, path);

    expect(r).toEqual({ migrated: true, active: 'default' });
    const file = onDisk();
    expect(file.baseUrl).toBeUndefined();
    expect(file.apiKey).toBeUndefined();
    expect(file.profiles.default).toMatchObject({ baseUrl: 'http://old:3000', apiKey: 'old-key', model: 'm1' });
    expect(file.currentProfile).toBe('default');
    expect(loadConfig({}, path)).toMatchObject({ apiKey: 'old-key', baseUrl: 'http://old:3000' });
  });

  it('refuses duplicates and explains a clash with the migrated "default"', () => {
    seed({ apiKey: 'old-key' });
    expect(() => addProfile('default', { baseUrl: 'http://x:1', apiKey: 'k' }, path)).toThrow(/earlier settings/);
    expect(onDisk().apiKey).toBe('old-key'); // nothing was written
  });

  it.each(['constructor', 'prototype'])('rejects the reserved name %s', (name) => {
    expect(() => addProfile(name, { baseUrl: 'http://x:1', apiKey: 'k' }, path)).toThrow(/reserved/);
  });

  it('rejects __proto__ (not a valid profile name at all)', () => {
    expect(() => addProfile('__proto__', { baseUrl: 'http://x:1', apiKey: 'k' }, path)).toThrow(/Profile name/);
  });

  it('does not treat inherited object keys as existing profiles', () => {
    addProfile('a', { baseUrl: 'http://x:1', apiKey: 'k' }, path);
    expect(() => useProfile('constructor', path)).toThrow(/does not exist/);
    expect(() => removeProfile('toString', path)).toThrow(/does not exist/);
    expect(listProfiles(path).map((p) => p.name)).toEqual(['a']);
  });

  it('rejects base URLs without an http(s) scheme', () => {
    expect(() => addProfile('a', { baseUrl: 'localhost:3000', apiKey: 'k' }, path)).toThrow(/http/);
    expect(() => addProfile('a', { baseUrl: 'ftp://x', apiKey: 'k' }, path)).toThrow(/http/);
    expect(() => saveConfigValue('baseUrl', 'nope', path)).toThrow(/URL/);
  });
});

describe('the profile add command', () => {
  it('uses the default gateway, not the active profile or LLM_BASE_URL', async () => {
    vi.stubEnv('XDG_CONFIG_HOME', dir);
    vi.stubEnv('LLM_BASE_URL', 'http://env-gateway:9999');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const cfg = join(dir, 'llm-gateway', 'config.json');
    mkdirSync(dirname(cfg), { recursive: true });
    writeFileSync(
      cfg,
      JSON.stringify({ currentProfile: 'work', profiles: { work: { baseUrl: 'http://work:3000', apiKey: 'wk' } } }),
    );

    await profileAddCommand('personal', { apiKey: 'pk' });

    const saved = JSON.parse(readFileSync(cfg, 'utf8'));
    expect(saved.profiles.personal.baseUrl).toBe('http://localhost:3000');
    expect(saved.currentProfile).toBe('work'); // adding never silently switches
  });
});

describe('removing and switching profiles', () => {
  beforeEach(() => {
    addProfile('a', { baseUrl: 'http://a:1', apiKey: 'ka' }, path);
    addProfile('b', { baseUrl: 'http://b:1', apiKey: 'kb' }, path);
  });

  it('refuses to remove the active profile when others exist', () => {
    expect(() => removeProfile('a', path)).toThrow(/active profile/);
    expect(Object.keys(onDisk().profiles)).toEqual(['a', 'b']);
  });

  it('with --force removes it and leaves NO profile active (no silent switch)', () => {
    const r = removeProfile('a', path, { force: true });
    expect(r).toEqual({ wasActive: true, remaining: ['b'] });
    expect(onDisk().currentProfile).toBeUndefined();
  });

  it('removes an inactive profile without touching the active one', () => {
    removeProfile('b', path);
    expect(onDisk().currentProfile).toBe('a');
    expect(Object.keys(onDisk().profiles)).toEqual(['a']);
  });

  it('removing the last profile clears the profiles section', () => {
    removeProfile('b', path);
    removeProfile('a', path);
    expect(onDisk().profiles).toBeUndefined();
    expect(onDisk().currentProfile).toBeUndefined();
  });
});

describe('effective config safety', () => {
  beforeEach(() => {
    addProfile('work', { baseUrl: 'http://work.example:3000', apiKey: 'work-key', model: 'm' }, path);
  });

  it('withholds the saved key when LLM_BASE_URL points at another gateway', () => {
    const c = loadConfig({ LLM_BASE_URL: 'http://evil.example:3000' }, path);
    expect(c.baseUrl).toBe('http://evil.example:3000');
    expect(c.apiKey).toBeUndefined();
    expect(c.keyWithheldFor).toBe('http://evil.example:3000');
    expect(c.overrides).toEqual(['baseUrl']);
  });

  it('uses the env key when both URL and key are given', () => {
    const c = loadConfig({ LLM_BASE_URL: 'http://other:3000', LLM_API_KEY: 'env-key' }, path);
    expect(c).toMatchObject({ baseUrl: 'http://other:3000', apiKey: 'env-key', keyWithheldFor: undefined });
    expect(c.overrides).toEqual(['baseUrl', 'apiKey']);
  });

  it('keeps the saved key when the env URL is the same gateway written differently', () => {
    const c = loadConfig({ LLM_BASE_URL: 'HTTP://Work.Example:3000/' }, path);
    expect(c.apiKey).toBe('work-key');
    expect(c.keyWithheldFor).toBeUndefined();
    expect(c.overrides).toBeUndefined();
  });

  it('treats empty environment variables as unset', () => {
    const c = loadConfig({ LLM_BASE_URL: '', LLM_API_KEY: '', LLM_MODEL: '' }, path);
    expect(c).toMatchObject({ baseUrl: 'http://work.example:3000', apiKey: 'work-key', model: 'm' });
  });

  it('does not fall back to flat credentials when the active profile is gone', () => {
    seed({ apiKey: 'flat-key', baseUrl: 'http://flat:1', currentProfile: 'gone', profiles: {} });
    const c = loadConfig({}, path);
    expect(c.apiKey).toBeUndefined();
    expect(c.profileProblem).toMatch(/"gone" no longer exists/);
  });

  it('getClient refuses to run on a broken profile or a withheld key', () => {
    vi.stubEnv('XDG_CONFIG_HOME', dir);
    const cfg = join(dir, 'llm-gateway', 'config.json');
    mkdirSync(dirname(cfg), { recursive: true });
    writeFileSync(cfg, JSON.stringify({ currentProfile: 'gone', profiles: {} }));
    expect(() => getClient()).toThrow(/no longer exists/);

    writeFileSync(cfg, JSON.stringify({ currentProfile: 'w', profiles: { w: { baseUrl: 'http://w:1', apiKey: 'k' } } }));
    vi.stubEnv('LLM_BASE_URL', 'http://elsewhere:1');
    expect(() => getClient()).toThrow(/different gateway/);
  });

  it('saveConfigValue writes into the active profile and refuses a dangling one', () => {
    saveConfigValue('model', 'new-model', path);
    expect(onDisk().profiles.work.model).toBe('new-model');
    seed({ currentProfile: 'gone', profiles: {} });
    expect(() => saveConfigValue('model', 'x', path)).toThrow(/no longer exists/);
  });
});

describe('config file handling', () => {
  it('writes atomically with owner-only permissions and leaves no temp files', () => {
    addProfile('a', { baseUrl: 'http://a:1', apiKey: 'k' }, path);
    useProfile('a', path);
    saveConfigValue('model', 'm', path);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(dirname(path))).toEqual(['config.json']);
  });

  it('rejects config files that are not JSON objects', () => {
    seed([]);
    expect(() => readConfigFile(path)).toThrow(/JSON object/);
    seed({ profiles: [] });
    expect(() => readConfigFile(path)).toThrow(/must be an object/);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{nope');
    expect(() => readConfigFile(path)).toThrow(/not valid JSON/);
  });
});

describe('collecting the API key', () => {
  it('accepts --api-key but warns that it leaks into shell history', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(resolveApiKeyInput({ apiKey: 'abc' })).resolves.toBe('abc');
    expect(err).toHaveBeenCalledWith(expect.stringContaining('shell history'));
  });

  it('explains the options when there is no terminal and no key', async () => {
    await expect(resolveApiKeyInput({})).rejects.toThrow(/--api-key-stdin/);
  });
});
