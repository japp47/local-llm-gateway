import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, maskKey, saveConfigValue } from '../src/config.js';

describe('config', () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'llm-cli-'));
    path = join(dir, 'nested', 'config.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('defaults when nothing is set', () => {
    expect(loadConfig({}, path)).toEqual({ baseUrl: 'http://localhost:3000', apiKey: undefined, model: undefined });
  });

  it('saves values, strips trailing slashes, and locks the file to the owner', () => {
    saveConfigValue('baseUrl', 'http://gw.local:3000//', path);
    saveConfigValue('apiKey', 'llmgw_secret', path);
    expect(loadConfig({}, path)).toMatchObject({ baseUrl: 'http://gw.local:3000', apiKey: 'llmgw_secret' });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('environment variables override the file', () => {
    saveConfigValue('apiKey', 'from-file', path);
    expect(loadConfig({ LLM_API_KEY: 'from-env', LLM_BASE_URL: 'http://x:1/' }, path)).toMatchObject({
      apiKey: 'from-env',
      baseUrl: 'http://x:1',
    });
  });

  it('never prints a full key', () => {
    expect(maskKey('llmgw_abcdefghijklmnop')).toBe('llmgw_…mnop');
    expect(maskKey('short')).toBe('****');
    expect(maskKey(undefined)).toBe('(not set)');
  });
});