import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addProfile, loadConfig, saveConfigValue } from '../src/config.js';
import { gatewayDataDir, readLocalCredentials, sameLocalGateway } from '../src/local-credentials.js';

describe('local gateway credentials', () => {
  let dir: string;
  let configFile: string;
  let credsFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'llm-cli-local-'));
    configFile = join(dir, 'config', 'config.json');
    credsFile = join(dir, 'local-credentials.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const writeCreds = (baseUrl: string, apiKey = 'llmgw_local_key', mode = 0o600) => {
    writeFileSync(credsFile, JSON.stringify({ baseUrl, apiKey }));
    chmodSync(credsFile, mode);
  };
  const load = (env: Record<string, string> = {}) => loadConfig(env, configFile, credsFile);

  it('uses the local key when nothing is configured and the URL is the local gateway', () => {
    writeCreds('http://localhost:3000');
    expect(load()).toMatchObject({
      baseUrl: 'http://localhost:3000',
      apiKey: 'llmgw_local_key',
      keySource: 'local-gateway',
    });
  });

  it('treats localhost, 127.0.0.1 and ::1 as the same machine', () => {
    writeCreds('http://localhost:3000');
    expect(load({ LLM_BASE_URL: 'http://127.0.0.1:3000' }).apiKey).toBe('llmgw_local_key');
    expect(load({ LLM_BASE_URL: 'http://[::1]:3000/' }).apiKey).toBe('llmgw_local_key');
  });

  it('never sends the local key to another port, host or scheme', () => {
    writeCreds('http://localhost:3000');
    for (const url of ['http://localhost:3001', 'http://gw.example.com:3000', 'http://192.168.1.5:3000', 'https://localhost:3000']) {
      const c = load({ LLM_BASE_URL: url });
      expect(c.apiKey, url).toBeUndefined();
      expect(c.keySource, url).toBeUndefined();
    }
  });

  it('a configured key always wins', () => {
    writeCreds('http://localhost:3000');
    expect(load({ LLM_API_KEY: 'from-env' })).toMatchObject({ apiKey: 'from-env' });
    saveConfigValue('apiKey', 'from-file', configFile);
    expect(load()).toMatchObject({ apiKey: 'from-file' });
    expect(load().keySource).toBeUndefined();
  });

  it('stands in for a withheld key only when LLM_BASE_URL is the local gateway', () => {
    writeCreds('http://localhost:3000');
    addProfile('work', { baseUrl: 'http://work.example.com', apiKey: 'work-key' }, configFile);

    const local = load({ LLM_BASE_URL: 'http://localhost:3000' });
    expect(local).toMatchObject({ apiKey: 'llmgw_local_key', keySource: 'local-gateway' });
    expect(local.keyWithheldFor).toBeUndefined();

    const elsewhere = load({ LLM_BASE_URL: 'http://other.example.com' });
    expect(elsewhere.apiKey).toBeUndefined();
    expect(elsewhere.keyWithheldFor).toBe('http://other.example.com');
  });

  it('is ignored, with a reason, when other users can read the file', () => {
    writeCreds('http://localhost:3000', 'llmgw_local_key', 0o644);
    const c = load();
    expect(c.apiKey).toBeUndefined();
    expect(c.localKeyIgnored).toMatch(/can be read by other users.*chmod 600/);
  });

  it('copes with a missing or damaged file', () => {
    expect(load().apiKey).toBeUndefined();
    writeFileSync(credsFile, '{"baseUrl":');
    chmodSync(credsFile, 0o600);
    expect(readLocalCredentials(credsFile)).toEqual({ kind: 'none' });
    expect(load().apiKey).toBeUndefined();
  });

  it('looks in the same data folder as the gateway', () => {
    expect(gatewayDataDir({}, 'darwin', '/Users/me')).toBe('/Users/me/Library/Application Support/llm-gateway');
    expect(gatewayDataDir({ XDG_DATA_HOME: '/d' }, 'linux', '/home/me')).toBe('/d/llm-gateway');
    expect(gatewayDataDir({ DATA_DIR: '/custom' }, 'darwin', '/Users/me')).toBe('/custom');
  });

  it('compares URLs safely', () => {
    expect(sameLocalGateway('http://localhost:80', 'http://127.0.0.1')).toBe(true);
    expect(sameLocalGateway('not a url', 'http://localhost:3000')).toBe(false);
    expect(sameLocalGateway('http://localhost.evil.com:3000', 'http://localhost:3000')).toBe(false);
  });
});
