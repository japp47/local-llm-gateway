// Server mode only: the Redis-backed rate limiter. Single-user mode uses an in-memory
// limiter, so these run only when the suite runs on Postgres (TEST_BACKEND=postgres).
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createConfig } from '../src/config.js';
import { FakeProvider, makeTestApp, TEST_BACKEND, TEST_DB_URL } from './helpers.js';

const REDIS = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379';
const offline = { version: async () => 'x', installed: async () => [], loaded: async () => [] };

describe.skipIf(TEST_BACKEND !== 'postgres')('rate limiting with Redis (server mode)', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn();
  });

  const env = (extra: Record<string, string> = {}) => ({ REDIS_URL: REDIS, RATE_LIMIT_MAX: '2', RATE_LIMIT_WINDOW: '1 minute', ...extra });

  it('shares one limit across gateway instances: the count lives in Redis, not in each process', async () => {
    const a = await makeTestApp(new FakeProvider(), env());
    cleanup.push(a.close);
    // A second gateway on the same database and the same Redis, like a second replica.
    const config = createConfig({ DATABASE_URL: TEST_DB_URL, LOG_LEVEL: 'silent', ALLOWED_MODELS: 'fake-model', DEFAULT_MODEL: 'fake-model', ...env() });
    const b = await buildApp({ config, provider: new FakeProvider(), storage: a.deps.storage, ollama: offline });
    cleanup.push(() => b.app.close());

    const { headers } = await a.addUser(`shared-${Date.now()}@example.com`); // a fresh key: a fresh count
    expect((await a.app.inject({ method: 'GET', url: '/v1/me', headers })).statusCode).toBe(200);
    expect((await b.app.inject({ method: 'GET', url: '/v1/me', headers })).statusCode).toBe(200);
    const third = await a.app.inject({ method: 'GET', url: '/v1/me', headers });
    expect(third.statusCode).toBe(429);
    expect(third.json().error.code).toBe('rate_limited');
  });

  it('counts per API key, not per address', async () => {
    const t = await makeTestApp(new FakeProvider(), env());
    cleanup.push(t.close);
    const one = await t.addUser(`one-${Date.now()}@example.com`);
    const two = await t.addUser(`two-${Date.now()}@example.com`);
    for (let i = 0; i < 2; i++) await t.app.inject({ method: 'GET', url: '/v1/me', headers: one.headers });
    expect((await t.app.inject({ method: 'GET', url: '/v1/me', headers: one.headers })).statusCode).toBe(429);
    expect((await t.app.inject({ method: 'GET', url: '/v1/me', headers: two.headers })).statusCode).toBe(200);
  });

  it('keeps serving when Redis is down, instead of failing every request', async () => {
    const t = await makeTestApp(new FakeProvider(), env({ REDIS_URL: 'redis://127.0.0.1:1' })); // nothing listens there
    cleanup.push(t.close);
    const { headers } = await t.addUser(`noredis-${Date.now()}@example.com`);
    for (let i = 0; i < 4; i++) {
      expect((await t.app.inject({ method: 'GET', url: '/v1/me', headers })).statusCode).toBe(200);
    }
  });
});
