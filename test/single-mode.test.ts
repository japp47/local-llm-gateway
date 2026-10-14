// Single-user mode only: no DATABASE_URL, so storage is SQLite in the data folder.
// Runs in the unit suite because it needs no services.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createConfig, defaultDataDir } from '../src/config.js';
import { acquireInstanceLock, StartupError } from '../src/lib/instance-lock.js';
import { lockPath, openStorage, sqlitePath } from '../src/storage/index.js';
import { addUser, FakeProvider } from './helpers.js';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

function tempDataDir() {
  const root = mkdtempSync(join(tmpdir(), 'llmgw-single-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  return join(root, 'nested', 'data'); // does not exist yet
}

const singleConfig = (dataDir: string) =>
  createConfig({
    DATA_DIR: dataDir,
    LOG_LEVEL: 'silent',
    ALLOWED_MODELS: 'fake-model',
    DEFAULT_MODEL: 'fake-model',
  });

/** A real, separate process whose PID we can put in a lock file, then kill. */
async function otherProcess(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  cleanup.push(() => void child.kill('SIGKILL'));
  await new Promise((r) => child.once('spawn', r));
  return child;
}

describe('mode selection', () => {
  it('is server mode only when DATABASE_URL is set; empty counts as unset', () => {
    expect(createConfig({ DATABASE_URL: 'postgres://x@h/db' }).mode).toBe('server');
    expect(createConfig({}).mode).toBe('single');
    expect(createConfig({ DATABASE_URL: '', REDIS_URL: '' })).toMatchObject({
      mode: 'single',
      DATABASE_URL: undefined,
      REDIS_URL: undefined,
    });
  });

  it('puts the data folder where each OS expects it, unless DATA_DIR says otherwise', () => {
    expect(defaultDataDir('darwin', {}, '/Users/me')).toBe('/Users/me/Library/Application Support/llm-gateway');
    expect(defaultDataDir('linux', {}, '/home/me')).toBe('/home/me/.local/share/llm-gateway');
    expect(defaultDataDir('linux', { XDG_DATA_HOME: '/data' }, '/home/me')).toBe('/data/llm-gateway');
    expect(createConfig({ DATA_DIR: '/tmp/x' }).dataDir).toBe('/tmp/x');
  });
});

describe('single-user storage', () => {
  it('creates a private data folder and a migrated database on first run', async () => {
    const config = singleConfig(tempDataDir());
    const storage = await openStorage(config);
    cleanup.push(() => storage.close());

    expect(statSync(config.dataDir).mode & 0o777).toBe(0o700);
    expect(statSync(sqlitePath(config)).mode & 0o777).toBe(0o600);
    expect(await storage.ping()).toBe(true);
    expect((await storage.users.create('me@local')).email).toBe('me@local'); // tables exist
  });

  it('keeps history across a restart, and releases the lock on close', async () => {
    const config = singleConfig(tempDataDir());
    const provider = new FakeProvider();

    const first = await buildApp({ config, provider });
    const a = await addUser(first.deps, 'me@local');
    const conv = await first.app.inject({ method: 'POST', url: '/v1/conversations', headers: a.headers, payload: { title: 'Keep me' } });
    const id = conv.json().id as string;
    await first.app.inject({ method: 'POST', url: `/v1/conversations/${id}/messages`, headers: a.headers, payload: { content: 'hi' } });
    expect(JSON.parse(readFileSync(lockPath(config), 'utf8')).pid).toBe(process.pid);
    await first.app.close();
    expect(existsSync(lockPath(config))).toBe(false);

    const second = await buildApp({ config, provider });
    cleanup.push(() => second.app.close());
    const again = await second.app.inject({ method: 'GET', url: `/v1/conversations/${id}`, headers: a.headers });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ title: 'Keep me', messageCount: 2 });
  });
});

describe('one gateway per data folder', () => {
  it('refuses to start while another live process holds the lock', async () => {
    const config = singleConfig(tempDataDir());
    const other = await otherProcess();
    await (await openStorage(config)).close(); // create the folder
    writeFileSync(lockPath(config), JSON.stringify({ pid: other.pid }));

    await expect(openStorage(config)).rejects.toThrow(StartupError);
    await expect(openStorage(config)).rejects.toThrow(/Another gateway is already using this data folder/);
  });

  it('takes over the lock left behind by a crashed gateway', async () => {
    const config = singleConfig(tempDataDir());
    const other = await otherProcess();
    await (await openStorage(config)).close();
    writeFileSync(lockPath(config), JSON.stringify({ pid: other.pid }));

    other.kill('SIGKILL'); // crash: the lock file stays behind
    await new Promise((r) => other.once('exit', r));

    const storage = await openStorage(config);
    cleanup.push(() => storage.close());
    expect(JSON.parse(readFileSync(lockPath(config), 'utf8')).pid).toBe(process.pid);
  });

  it('treats an unreadable lock file as stale', () => {
    const dir = mkdtempSync(join(tmpdir(), 'llmgw-lock-'));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'gateway.lock');
    writeFileSync(path, '{"pid":'); // half-written by a crash

    const release = acquireInstanceLock(path);
    expect(JSON.parse(readFileSync(path, 'utf8')).pid).toBe(process.pid);
    release();
    expect(existsSync(path)).toBe(false);
  });
});
