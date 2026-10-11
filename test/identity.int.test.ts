import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apiKeys } from '../src/db/schema.js';
import { sha256 } from '../src/lib/hash.js';
import { FakeProvider, makeTestApp } from './helpers.js';

type T = Awaited<ReturnType<typeof makeTestApp>>;

describe('identity and models endpoints', () => {
  let t: T;

  beforeEach(async () => {
    t = await makeTestApp(new FakeProvider());
  });
  afterEach(async () => {
    await t.close();
  });

  it('GET /v1/me returns the user behind the key, and nothing secret', async () => {
    const a = await t.addUser('a@example.com');
    const res = await t.app.inject({ method: 'GET', url: '/v1/me', headers: a.headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: a.userId, email: 'a@example.com' });
    expect(res.payload).not.toContain(a.key);
  });

  it('requires a valid, unrevoked key', async () => {
    const none = await t.app.inject({ method: 'GET', url: '/v1/me' });
    expect(none.statusCode).toBe(401);

    const a = await t.addUser('a@example.com');
    await t.deps.db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.keyHash, sha256(a.key)));
    const revoked = await t.app.inject({ method: 'GET', url: '/v1/me', headers: a.headers });
    expect(revoked.statusCode).toBe(401);
    expect(revoked.json().error.code).toBe('invalid_api_key');
  });

  it('two keys of the same user resolve to the same identity', async () => {
    const a = await t.addUser('a@example.com');
    const second = 'llmgw_second_key_for_a';
    await t.deps.repos.apiKeys.create(a.userId, sha256(second), 'laptop');
    const res = await t.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${second}` } });
    expect(res.json().id).toBe(a.userId);
  });

  it('lists the allowed models and marks the default', async () => {
    const a = await t.addUser('a@example.com');
    const list = await t.app.inject({ method: 'GET', url: '/v1/models', headers: a.headers });
    expect(list.json().data).toEqual([
      { id: 'fake-model', default: true },
      { id: 'other-model', default: false },
    ]);
    const one = await t.app.inject({ method: 'GET', url: '/v1/model', headers: a.headers });
    expect(one.json()).toEqual({ id: 'fake-model', default: true });
  });
});
