// The gateway's self-checks (startup log and GET /v1/doctor). Unit suite: no services;
// single-user mode in a temp folder and a fake Ollama.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createConfig } from '../src/config.js';
import { ollamaUnavailable } from '../src/providers/ollama-errors.js';
import type { InstalledModel, LoadedModel } from '../src/providers/ollama-models.js';
import { databaseCheck, type OllamaInfo } from '../src/services/doctor.js';
import { addUser, FakeProvider } from './helpers.js';

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

const llama: InstalledModel = {
  name: 'llama3.2:3b',
  sizeBytes: 2_019_393_189,
  capabilities: ['completion'],
  arch: { blockCount: 28, headCountKv: 8, keyLength: 128, valueLength: 128 },
};

function fakeOllama(installed: InstalledModel[] = [llama], loaded: LoadedModel[] = []) {
  const o = {
    down: false,
    installed: installed,
    loaded: loaded,
  };
  const info: OllamaInfo = {
    version: async () => {
      if (o.down) throw ollamaUnavailable();
      return '0.35.1';
    },
    installed: async () => {
      if (o.down) throw ollamaUnavailable();
      return o.installed;
    },
    loaded: async () => o.loaded,
  };
  return { o, info };
}

async function doctor(ollama: OllamaInfo, env: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'llmgw-doctor-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const config = createConfig({ DATA_DIR: join(root, 'data'), LOG_LEVEL: 'silent', ...env });
  const { app, deps } = await buildApp({ config, provider: new FakeProvider(), ollama, totalMemoryBytes: 16 * 2 ** 30 });
  cleanup.push(() => app.close());
  const a = await addUser(deps, 'me@local');
  const res = await app.inject({ method: 'GET', url: '/v1/doctor', headers: a.headers });
  return { status: res.statusCode, body: res.json() as { mode: string; checks: Array<{ id: string; status: string; message: string; hint?: string }> }, app };
}

describe('GET /v1/doctor', () => {
  it('all good: Ollama, a model that fits, an up-to-date database', async () => {
    const { status, body } = await doctor(fakeOllama().info);
    expect(status).toBe(200);
    expect(body.mode).toBe('single');
    expect(body.checks).toEqual([
      { id: 'ollama', status: 'ok', message: 'Ollama 0.35.1 is running.' },
      { id: 'model', status: 'ok', message: 'Model llama3.2:3b is ready: needs about 2.6 of 8.0 GB.' },
      { id: 'database', status: 'ok', message: 'The database (SQLite) is up to date.' },
    ]);
  });

  it('Ollama down: says so with the fix, skips the model checks, still checks the database', async () => {
    const { o, info } = fakeOllama();
    o.down = true;
    const { body } = await doctor(info);
    expect(body.checks.map((c) => [c.id, c.status])).toEqual([['ollama', 'fail'], ['database', 'ok']]);
    expect(body.checks[0]).toMatchObject({ message: "Ollama isn't running.", hint: 'Open the Ollama app (or run: ollama serve), then try again.' });
  });

  it('nothing downloaded: names the model to pull for this memory size', async () => {
    const { body } = await doctor(fakeOllama([]).info);
    expect(body.checks.find((c) => c.id === 'model')).toMatchObject({ status: 'fail', hint: 'Run: ollama pull qwen3:8b' });
  });

  it('DEFAULT_MODEL not downloaded: the exact pull command', async () => {
    const { body } = await doctor(fakeOllama().info, { DEFAULT_MODEL: 'qwen3:4b' });
    expect(body.checks.find((c) => c.id === 'model')).toMatchObject({ status: 'fail', hint: 'Run: ollama pull qwen3:4b' });
  });

  it('a loaded model that spilled to the CPU is a warning', async () => {
    const loaded = [{ name: 'llama3.2:3b', sizeBytes: 100, vramBytes: 50, contextLength: 4096 }];
    const { body } = await doctor(fakeOllama([llama], loaded).info);
    expect(body.checks.find((c) => c.id === 'fit')).toMatchObject({ status: 'warn' });
    expect(body.checks.find((c) => c.id === 'fit')!.message).toContain('50% on the GPU');
  });

  it('needs an API key', async () => {
    const { app } = await doctor(fakeOllama().info);
    expect((await app.inject({ method: 'GET', url: '/v1/doctor' })).statusCode).toBe(401);
  });
});

describe('database check', () => {
  const store = (ok: boolean, applied: number, available: number) => ({
    ping: async () => ok,
    migrationStatus: async () => ({ applied, available }),
  });

  it('server mode, migrations pending: tells you to run db:migrate', async () => {
    expect(await databaseCheck(store(true, 2, 3), 'server')).toMatchObject({
      status: 'fail',
      message: 'The database needs an update (2 of 3 changes applied).',
      hint: 'Run: npm run db:migrate',
    });
  });

  it('Postgres not answering: how to start it', async () => {
    expect(await databaseCheck(store(false, 0, 3), 'server')).toMatchObject({
      status: 'fail',
      hint: 'Check that Postgres is running: docker compose up -d postgres',
    });
  });

  it('a database from a newer version is a warning, not a failure', async () => {
    expect((await databaseCheck(store(true, 4, 3), 'single')).status).toBe('warn');
  });
});
