import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CliConfig } from '../src/config.js';
import { runDoctor, type Check } from '../src/doctor.js';

const GW = 'http://localhost:3000';
const OLLAMA = 'http://127.0.0.1:11434';

interface World {
  gateway: 'single' | 'server' | 'down' | 'other';
  ollama: boolean;
  models: string[];
  validKeys: string[];
  gatewayChecks?: Check[];
}

/** A fake network: our gateway (or not), Ollama (or not). */
function net(w: World): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const key = new Headers(init?.headers).get('authorization')?.replace('Bearer ', '') ?? '';
    if (url.startsWith(OLLAMA)) {
      if (!w.ollama) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
      if (url.endsWith('/api/version')) return Response.json({ version: '0.35.1' });
      return Response.json({ models: w.models.map((name) => ({ name })) });
    }
    if (w.gateway === 'down') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    if (w.gateway === 'other') return new Response('<html>hello</html>', { status: 200 });
    if (url.endsWith('/healthz')) return Response.json({ ok: true, mode: w.gateway });
    if (!w.validKeys.includes(key)) return Response.json({ error: { code: 'invalid_api_key' } }, { status: 401 });
    if (url.endsWith('/v1/me')) return Response.json({ id: 'u', email: 'local@localhost' });
    if (url.endsWith('/v1/doctor')) return Response.json({ mode: w.gateway, checks: w.gatewayChecks ?? [] });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
}

let dataDir: string;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'llm-doctor-'));
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

const config = (over: Partial<CliConfig> = {}): CliConfig => ({ baseUrl: GW, apiKey: 'k-local', currentProfile: 'local', ...over });

const run = (w: World, c = config(), alive: (pid: number) => boolean = () => false) =>
  runDoctor({ config: c, profiles: [], local: { kind: 'none' }, dataDir, ollamaUrl: OLLAMA, fetchImpl: net(w), isAlive: alive });

const summary = (checks: Check[]) => checks.map((c) => `${c.id}:${c.status}`);

describe('llm doctor', () => {
  it('everything fine: config, gateway, key, then the gateway\'s own checks', async () => {
    const gatewayChecks: Check[] = [
      { id: 'ollama', status: 'ok', message: 'Ollama 0.35.1 is running.' },
      { id: 'model', status: 'ok', message: 'Model llama3.2:3b is ready: needs about 2.6 of 8.0 GB.' },
      { id: 'database', status: 'ok', message: 'The database (SQLite) is up to date.' },
    ];
    const checks = await run({ gateway: 'single', ollama: true, models: [], validKeys: ['k-local'], gatewayChecks });
    expect(summary(checks)).toEqual(['config:ok', 'gateway:ok', 'key:ok', 'ollama:ok', 'model:ok', 'database:ok']);
    expect(checks[1]!.message).toBe('The assistant is running at http://localhost:3000 (single-user mode).');
    expect(checks[2]!.message).toBe('Your key works (signed in as local@localhost).');
  });

  it('gateway down: says how to start it, and checks Ollama directly', async () => {
    const checks = await run({ gateway: 'down', ollama: true, models: ['llama3.2:3b', 'nomic-embed-text:latest'], validKeys: [] });
    expect(summary(checks)).toEqual(['config:ok', 'gateway:fail', 'ollama:ok', 'model:ok']);
    expect(checks[1]!.hint).toContain('npm start');
    expect(checks[3]!.message).toBe('1 chat model downloaded (llama3.2:3b).');
  });

  it('gateway and Ollama both down: two problems, each with its fix', async () => {
    const checks = await run({ gateway: 'down', ollama: false, models: [], validKeys: [] });
    expect(checks.filter((c) => c.status === 'fail').map((c) => c.id)).toEqual(['gateway', 'ollama']);
    expect(checks.find((c) => c.id === 'ollama')!.hint).toContain('ollama serve');
  });

  it('a crashed gateway: the lock file explains it recovers on the next start', async () => {
    writeFileSync(join(dataDir, 'gateway.lock'), JSON.stringify({ pid: 999999, port: 3000 }));
    const checks = await run({ gateway: 'down', ollama: true, models: ['m'], validKeys: [] });
    expect(checks[1]!.message).toContain('stopped without shutting down cleanly');
  });

  it('a gateway running on another port: points there', async () => {
    writeFileSync(join(dataDir, 'gateway.lock'), JSON.stringify({ pid: 123, port: 3001 }));
    const checks = await run({ gateway: 'down', ollama: true, models: ['m'], validKeys: [] }, config(), () => true);
    expect(checks[1]!.message).toContain('running on port 3001 instead');
  });

  it('another program on the port', async () => {
    const checks = await run({ gateway: 'other', ollama: true, models: [], validKeys: [] });
    expect(checks[1]).toMatchObject({ id: 'gateway', status: 'fail', message: 'Another program is answering at http://localhost:3000, not the assistant.' });
  });

  it('wrong key for the mode that is running: explains it, with the profile to use', async () => {
    const checks = await runDoctor({
      config: config({ apiKey: 'k-local', currentProfile: 'local' }),
      profiles: [{ name: 'storageTest', profile: { baseUrl: GW, apiKey: 'k-pg' } }],
      local: { kind: 'none' },
      dataDir,
      ollamaUrl: OLLAMA,
      fetchImpl: net({ gateway: 'server', ollama: true, models: [], validKeys: ['k-pg'] }),
    });
    const key = checks.find((c) => c.id === 'key')!;
    expect(key.status).toBe('fail');
    expect(key.message).toContain('server-mode gateway');
    expect(key.hint).toContain('llm profile use storageTest');
  });

  it('no key configured: one clear problem, and no requests that need a key', async () => {
    const checks = await run({ gateway: 'single', ollama: true, models: [], validKeys: [] }, config({ apiKey: undefined }));
    expect(summary(checks)).toEqual(['config:fail', 'gateway:ok']);
  });

  it('an older gateway without /v1/doctor is a warning', async () => {
    const f = net({ gateway: 'single', ollama: true, models: [], validKeys: ['k-local'] });
    const old = (async (url: string, init?: RequestInit) =>
      url.endsWith('/v1/doctor') ? new Response('{}', { status: 404 }) : f(url, init)) as typeof fetch;
    const checks = await runDoctor({ config: config(), profiles: [], local: { kind: 'none' }, dataDir, ollamaUrl: OLLAMA, fetchImpl: old });
    expect(checks.at(-1)).toMatchObject({ id: 'gateway-checks', status: 'warn' });
  });
});
