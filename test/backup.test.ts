// Backup and restore for single-user mode. Unit suite: real SQLite files in temp folders.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createConfig } from '../src/config.js';
import type { OllamaInfo } from '../src/services/doctor.js';
import { BackupError, restoreBackup } from '../src/services/backup.js';
import { lockPath } from '../src/storage/index.js';
import { createSqliteStorage } from '../src/storage/sqlite/index.js';
import { addUser, FakeProvider } from './helpers.js';

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

const offline: OllamaInfo = { version: async () => 'x', installed: async () => [], loaded: async () => [] };

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'llmgw-backup-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
const singleConfig = (dataDir: string) =>
  createConfig({ DATA_DIR: dataDir, LOG_LEVEL: 'silent', ALLOWED_MODELS: 'fake-model', DEFAULT_MODEL: 'fake-model' });

async function gateway(dataDir: string) {
  const { app, deps } = await buildApp({ config: singleConfig(dataDir), provider: new FakeProvider(), ollama: offline });
  return { app, deps, close: () => app.close() };
}

/** A gateway with one user and two conversations, one of them with an answer. */
async function withChats(dataDir: string) {
  const gw = await gateway(dataDir);
  const me = await addUser(gw.deps, 'me@local');
  const create = async (title: string) =>
    (await gw.app.inject({ method: 'POST', url: '/v1/conversations', headers: me.headers, payload: { title } })).json().id as string;
  const first = await create('Trip plan');
  await create('Recipes');
  await gw.app.inject({ method: 'POST', url: `/v1/conversations/${first}/messages`, headers: me.headers, payload: { content: 'hi' } });
  return { ...gw, me, first };
}

async function backupVia(app: Awaited<ReturnType<typeof gateway>>['app'], headers: Record<string, string>) {
  const res = await app.inject({ method: 'POST', url: '/v1/backup', headers });
  return { status: res.statusCode, body: res.json() };
}

describe('backup', () => {
  it('writes a checked, private copy while the gateway keeps running', async () => {
    const dataDir = join(tempRoot(), 'data');
    const gw = await withChats(dataDir);
    cleanup.push(gw.close);

    const { status, body } = await backupVia(gw.app, gw.me.headers);
    expect(status).toBe(201);
    expect(body).toMatchObject({ conversations: 2, messages: 2 }); // "hi" + the answer
    expect(body.file).toMatch(/backups\/gateway-\d{8}-\d{6}\.db$/);
    expect(statSync(body.file).mode & 0o777).toBe(0o600);
    expect(statSync(join(dataDir, 'backups')).mode & 0o777).toBe(0o700);
    expect(existsSync(`${body.file}-wal`)).toBe(false); // one self-contained file

    // the gateway still works afterwards
    expect((await gw.app.inject({ method: 'GET', url: '/v1/conversations', headers: gw.me.headers })).statusCode).toBe(200);
  });

  it('two backups in the same second get different names', async () => {
    const gw = await withChats(join(tempRoot(), 'data'));
    cleanup.push(gw.close);
    const a = (await backupVia(gw.app, gw.me.headers)).body.file;
    const b = (await backupVia(gw.app, gw.me.headers)).body.file;
    expect(a).not.toBe(b);
  });

  it('server mode: explains that Postgres has its own backup tools', async () => {
    const storage = createSqliteStorage(':memory:');
    await storage.migrate();
    const config = createConfig({ DATABASE_URL: 'postgres://x@h/db', LOG_LEVEL: 'silent' });
    const { app, deps } = await buildApp({ config, provider: new FakeProvider(), storage, ollama: offline });
    cleanup.push(async () => {
      await app.close();
      await storage.close();
    });
    const { status, body } = await backupVia(app, (await addUser(deps, 'a@b.c')).headers);
    expect(status).toBe(409);
    expect(body.error).toMatchObject({ code: 'backup_failed' });
    expect(body.error.hint).toContain('pg_dump');
  });
});

describe('restore', () => {
  it('round trip: a backup restored into a fresh data folder shows the same conversations', async () => {
    const root = tempRoot();
    const gw = await withChats(join(root, 'original'));
    const { body } = await backupVia(gw.app, gw.me.headers);
    const before = (await gw.app.inject({ method: 'GET', url: `/v1/conversations/${gw.first}`, headers: gw.me.headers })).json();
    await gw.close();

    const freshDir = join(root, 'fresh'); // does not exist yet
    expect(restoreBackup(singleConfig(freshDir), body.file)).toEqual({ conversations: 2, messages: 2 });

    const restored = await gateway(freshDir);
    cleanup.push(restored.close);
    // The same key works: its hash came back with the data.
    const list = (await restored.app.inject({ method: 'GET', url: '/v1/conversations', headers: gw.me.headers })).json();
    expect(list.data.map((c: { title: string }) => c.title).sort()).toEqual(['Recipes', 'Trip plan']);
    const after = (await restored.app.inject({ method: 'GET', url: `/v1/conversations/${gw.first}`, headers: gw.me.headers })).json();
    expect(after.messages).toEqual(before.messages);
    // The CLI's local key was replaced on start, so `llm` keeps working with no setup.
    expect(existsSync(join(freshDir, 'local-credentials.json'))).toBe(true);
  });

  it('keeps the database it replaces, with its WAL files', async () => {
    const root = tempRoot();
    const gw = await withChats(join(root, 'data'));
    const { body } = await backupVia(gw.app, gw.me.headers);
    await gw.close();

    const result = restoreBackup(singleConfig(join(root, 'data')), body.file);
    expect(result.previous).toMatch(/backups\/before-restore-\d{8}-\d{6}\.db$/);
    expect(existsSync(result.previous!)).toBe(true);
    expect(readdirSync(join(root, 'data')).filter((f) => f.startsWith('gateway.db'))).toEqual(['gateway.db']);
  });

  it('refuses while the assistant is running', async () => {
    const root = tempRoot();
    const gw = await withChats(join(root, 'data'));
    const { body } = await backupVia(gw.app, gw.me.headers);
    await gw.close();
    // Another live process holds the data folder (as a running gateway would).
    const other: ChildProcess = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    cleanup.push(() => other.kill('SIGKILL'));
    await new Promise((r) => other.once('spawn', r));
    writeFileSync(lockPath(singleConfig(join(root, 'data'))), JSON.stringify({ pid: other.pid }));

    expect(() => restoreBackup(singleConfig(join(root, 'data')), body.file)).toThrow('The assistant is running. Stop it first');
  });

  it('refuses files that are not assistant backups, and leaves the data alone', async () => {
    const root = tempRoot();
    const junk = join(root, 'notes.txt');
    writeFileSync(junk, 'hello');
    const other = join(root, 'other.db');
    const db = new Database(other);
    db.exec('create table x (a)');
    db.close();

    const config = singleConfig(join(root, 'data'));
    expect(() => restoreBackup(config, join(root, 'missing.db'))).toThrow('There is no file');
    expect(() => restoreBackup(config, junk)).toThrow(BackupError);
    expect(() => restoreBackup(config, other)).toThrow("not one of the assistant's");
    expect(existsSync(join(root, 'data'))).toBe(false); // nothing created
  });

  it('refuses in server mode, naming both ways to restore', () => {
    const config = createConfig({ DATABASE_URL: 'postgres://x@h/db' });
    expect(() => restoreBackup(config, '/tmp/x.db')).toThrow('DATABASE_URL is set');
  });
});
