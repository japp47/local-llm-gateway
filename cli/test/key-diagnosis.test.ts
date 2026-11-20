import { describe, expect, it } from 'vitest';
import type { CliConfig, CliProfile } from '../src/config.js';
import { explainRejectedKey, gatewayMode } from '../src/key-diagnosis.js';
import type { LocalCredentialsResult } from '../src/local-credentials.js';

const URL_ = 'http://localhost:3000';

/** A fake gateway: reports a mode on /healthz and accepts only `validKeys` on /v1/me. */
function gateway(mode: 'single' | 'server' | undefined, validKeys: string[]) {
  const sentTo: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    sentTo.push(url);
    if (url.endsWith('/healthz')) return Response.json(mode ? { ok: true, mode } : { ok: true });
    const auth = new Headers(init?.headers).get('authorization') ?? '';
    return validKeys.includes(auth.replace('Bearer ', '')) ? Response.json({ id: 'u' }) : new Response('{}', { status: 401 });
  }) as typeof fetch;
  return { fetchImpl, sentTo };
}

const profile = (apiKey?: string, baseUrl = URL_): CliProfile => ({ baseUrl, apiKey });
const noLocal: LocalCredentialsResult = { kind: 'none' };
const localKey = (apiKey = 'k-sqlite'): LocalCredentialsResult => ({ kind: 'found', credentials: { baseUrl: URL_, apiKey } });

describe('explaining a rejected key', () => {
  it('server profile against the single-user gateway: suggests the gateway\'s own key', async () => {
    const { fetchImpl } = gateway('single', ['k-sqlite']);
    const msg = await explainRejectedKey({
      config: { baseUrl: URL_, apiKey: 'k-postgres', currentProfile: 'storageTest' },
      profiles: [{ name: 'storageTest', profile: profile('k-postgres') }],
      local: localKey(),
      fetchImpl,
    });
    expect(msg).toContain('The key in profile "storageTest" isn\'t accepted by the single-user assistant (SQLite)');
    expect(msg).toContain('llm profile add local --local  then  llm profile use local');
  });

  it('...and names an existing --local profile instead of asking to create one', async () => {
    const { fetchImpl } = gateway('single', ['k-sqlite']);
    const msg = await explainRejectedKey({
      config: { baseUrl: URL_, apiKey: 'k-postgres', currentProfile: 'storageTest' },
      profiles: [{ name: 'storageTest', profile: profile('k-postgres') }, { name: 'mine', profile: profile() }],
      local: localKey(),
      fetchImpl,
    });
    expect(msg).toContain('llm profile use mine');
  });

  it('single-user key against the server gateway: names the saved profiles that work', async () => {
    const { fetchImpl } = gateway('server', ['k-a', 'k-b']);
    const msg = await explainRejectedKey({
      config: { baseUrl: URL_, apiKey: 'k-sqlite', currentProfile: 'local' },
      profiles: [
        { name: 'local', profile: profile('k-sqlite') },
        { name: 'default', profile: profile('k-a') },
        { name: 'old', profile: profile('k-revoked') },
        { name: 'work', profile: profile('k-b') },
      ],
      local: localKey(),
      fetchImpl,
    });
    expect(msg).toContain('the server-mode gateway (Postgres)');
    expect(msg).toContain('→ Switch to a profile that works with it: llm profile use default');
    expect(msg).toContain('(these work too: work)');
    expect(msg).not.toContain('old');
  });

  it('never sends a saved key to a URL it was not saved for', async () => {
    const { fetchImpl, sentTo } = gateway('server', ['k-remote']);
    const msg = await explainRejectedKey({
      config: { baseUrl: URL_, apiKey: 'k-x', currentProfile: 'a' },
      profiles: [{ name: 'remote', profile: profile('k-remote', 'http://gw.example.com:3000') }],
      local: noLocal,
      fetchImpl,
    });
    expect(sentTo.every((u) => u.startsWith(URL_))).toBe(true);
    expect(msg).toContain('npm run key:create');
  });

  it('nothing else works in single mode: suggests starting server mode', async () => {
    const { fetchImpl } = gateway('single', []);
    const config: CliConfig = { baseUrl: URL_, apiKey: 'k-x', currentProfile: 'p' };
    const msg = await explainRejectedKey({ config, profiles: [], local: noLocal, fetchImpl });
    expect(msg).toContain('Start that instead');
  });

  it('an older gateway without a mode still gets a useful next step', async () => {
    const { fetchImpl } = gateway(undefined, []);
    const msg = await explainRejectedKey({ config: { baseUrl: URL_, apiKey: 'k' }, profiles: [], local: noLocal, fetchImpl });
    expect(msg).toBe(
      `The saved key isn't accepted by the gateway at ${URL_}.\n→ Save a valid key with: llm config set apiKey  (you will be prompted)`,
    );
  });

  it('names LLM_API_KEY when that is where the key came from', async () => {
    const { fetchImpl } = gateway('server', []);
    const msg = await explainRejectedKey({
      config: { baseUrl: URL_, apiKey: 'k', overrides: ['apiKey'] },
      profiles: [],
      local: noLocal,
      fetchImpl,
    });
    expect(msg.startsWith('The key in LLM_API_KEY')).toBe(true);
  });
});

describe('gatewayMode', () => {
  it('is undefined when the gateway is unreachable or does not say', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    expect(await gatewayMode(URL_, down)).toBeUndefined();
    expect(await gatewayMode(URL_, gateway(undefined, []).fetchImpl)).toBeUndefined();
    expect(await gatewayMode(URL_, gateway('single', []).fetchImpl)).toBe('single');
  });
});
