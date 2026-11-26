// Behaviour every storage backend must share, beyond what the API tests already cover.
// These are the places where adapters tend to diverge: cascades, lease timing,
// ordering and cursor paging.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeProvider, makeTestApp, waitFor } from './helpers.js';

type T = Awaited<ReturnType<typeof makeTestApp>>;
type Headers = Record<string, string>;

describe('storage contract', () => {
  let t: T;
  let provider: FakeProvider;

  beforeEach(async () => {
    provider = new FakeProvider();
    t = await makeTestApp(provider);
  });
  afterEach(async () => {
    await t.close();
  });

  const send = (headers: Headers, id: string, content: string) =>
    t.app.inject({ method: 'POST', url: `/v1/conversations/${id}/messages`, headers, payload: { content } });
  const newConv = (userId: string) =>
    t.deps.repos.conversations.create({ userId, defaultModel: 'fake-model' });

  it('web sign-in codes work once, and only before they expire', async () => {
    const a = await t.addUser('web-a@example.com');
    const store = t.deps.storage.webSessions;
    const t0 = new Date('2026-11-20T10:00:00.000Z');
    const at = (ms: number) => new Date(t0.getTime() + ms);

    await store.createCode(a.userId, 'code-1', at(60_000), 'open');
    expect(await store.redeemCode('code-1', at(1_000))).toEqual({ userId: a.userId, purpose: 'open' });
    expect(await store.redeemCode('code-1', at(2_000))).toBeNull(); // used
    // Two redeems at the same moment: exactly one wins.
    await store.createCode(a.userId, 'code-race', at(60_000), 'open');
    const both = await Promise.all([store.redeemCode('code-race', at(1_000)), store.redeemCode('code-race', at(1_000))]);
    expect(both.filter(Boolean)).toHaveLength(1);

    await store.createCode(a.userId, 'code-2', at(60_000), 'open');
    expect(await store.redeemCode('code-2', at(60_000))).toBeNull(); // expired exactly at the deadline
    expect(await store.redeemCode('no-such-code', at(0))).toBeNull();
  });

  it('web sessions: found until they expire or are revoked; touching moves the expiry', async () => {
    const a = await t.addUser('web-b@example.com');
    const store = t.deps.storage.webSessions;
    const t0 = new Date('2026-11-20T10:00:00.000Z');
    const at = (ms: number) => new Date(t0.getTime() + ms);

    const { id } = await store.createSession(a.userId, 'tok-1', t0, at(1_000), { name: 'Mac', createdFrom: 'local' });
    expect(await store.findActiveSession('tok-1', at(500))).toMatchObject({ id, userId: a.userId, lastSeenAt: t0, createdFrom: 'local' });
    expect(await store.findActiveSession('tok-1', at(1_000))).toBeNull(); // idle too long
    await store.touchSession(id, at(900), at(10_000));
    expect(await store.findActiveSession('tok-1', at(5_000))).toMatchObject({ lastSeenAt: at(900) });

    expect(await store.revokeSession('tok-1', at(6_000))).toBe(true);
    expect(await store.revokeSession('tok-1', at(6_000))).toBe(false); // already revoked
    expect(await store.findActiveSession('tok-1', at(6_001))).toBeNull();

    await store.createSession(a.userId, 'tok-2', t0, at(1_000), { name: null, createdFrom: 'network' });
    await store.deleteExpired(at(2_000));
    expect(await store.touchSession(id, at(7_000), at(8_000))).toBeUndefined(); // no row: a no-op
    expect(await store.findActiveSession('tok-2', at(500))).toBeNull(); // removed
  });

  it('devices: listed per user (most recent first), revoked by id only by their owner', async () => {
    const a = await t.addUser('dev-a@example.com');
    const b = await t.addUser('dev-b@example.com');
    const store = t.deps.storage.webSessions;
    const t0 = new Date('2026-11-24T10:00:00.000Z');
    const at = (ms: number) => new Date(t0.getTime() + ms);

    await store.createCode(a.userId, 'pair-1', at(300_000), 'pair');
    expect(await store.redeemCode('pair-1', at(1_000))).toEqual({ userId: a.userId, purpose: 'pair' });

    const mac = await store.createSession(a.userId, 'tok-mac', t0, at(60_000), { name: 'Mac', createdFrom: 'local' });
    const phone = await store.createSession(a.userId, 'tok-phone', at(10), at(60_000), { name: 'iPhone', createdFrom: 'network' });
    await store.createSession(b.userId, 'tok-b', t0, at(60_000), { name: 'Other', createdFrom: 'local' });

    const list = await store.listSessions(a.userId, at(100));
    expect(list.map((d) => [d.deviceName, d.createdFrom])).toEqual([['iPhone', 'network'], ['Mac', 'local']]);
    expect(list[0]).toMatchObject({ id: phone.id, createdAt: expect.any(Date), lastSeenAt: at(10) });

    expect(await store.revokeSessionById(b.userId, phone.id, at(200))).toBe(false); // not b's device
    expect(await store.revokeSessionById(a.userId, phone.id, at(200))).toBe(true);
    expect(await store.revokeSessionById(a.userId, phone.id, at(201))).toBe(false); // already removed
    expect((await store.listSessions(a.userId, at(300))).map((d) => d.id)).toEqual([mac.id]);
    expect(await store.findActiveSession('tok-phone', at(300))).toBeNull();
    expect(await store.listSessions(a.userId, at(60_000))).toEqual([]); // all expired by then
  });

  it('reports a fully migrated database: every shipped migration applied', async () => {
    const { applied, available } = await t.deps.storage.migrationStatus();
    expect(available).toBeGreaterThan(0);
    expect(applied).toBe(available);
  });

  it('lists a user\'s keys, revoked ones included, and never another user\'s', async () => {
    const a = await t.addUser('a@example.com');
    const b = await t.addUser('b@example.com');
    const { apiKeys } = t.deps.repos;
    const second = await apiKeys.create(a.userId, 'hash-of-second-key', 'laptop');
    await apiKeys.revoke(a.keyId);

    const keys = await apiKeys.listForUser(a.userId); // created in the same ms: order not asserted
    expect(keys.map((k) => k.id).sort()).toEqual([a.keyId, second.id].sort());
    expect(keys.find((k) => k.id === a.keyId)!.revokedAt).toBeInstanceOf(Date);
    expect(keys.find((k) => k.id === second.id)).toMatchObject({ label: 'laptop', revokedAt: null });
    expect((await apiKeys.listForUser(b.userId)).map((k) => k.id)).toEqual([b.keyId]);
  });

  it('deleting a conversation removes its messages and keeps its generations, unlinked', async () => {
    const a = await t.addUser('a@example.com');
    const conv = await newConv(a.userId);
    expect((await send(a.headers, conv.id, 'hi')).statusCode).toBe(200);
    expect(await t.deps.repos.messages.countAll(conv.id)).toBe(2);

    const del = await t.app.inject({ method: 'DELETE', url: `/v1/conversations/${conv.id}`, headers: a.headers });
    expect(del.statusCode).toBe(204);

    expect(await t.deps.repos.messages.countAll(conv.id)).toBe(0);
    const gens = await t.deps.repos.generations.listByUser(a.userId);
    expect(gens).toHaveLength(1); // usage history outlives the conversation
    expect(gens[0]!.conversationId).toBeNull();
  });

  it('a lease has one holder at a time, is released explicitly, and expires on its own', async () => {
    const a = await t.addUser('a@example.com');
    const { conversations } = t.deps.repos;
    const conv = await newConv(a.userId);

    expect(await conversations.acquireLease(conv.id, 60)).toBe(true);
    expect(await conversations.acquireLease(conv.id, 60)).toBe(false);
    await conversations.releaseLease(conv.id);

    expect(await conversations.acquireLease(conv.id, 1)).toBe(true);
    expect(await conversations.acquireLease(conv.id, 1)).toBe(false);
    await waitFor(() => conversations.acquireLease(conv.id, 60), 3000); // the 1 s lease lapses
  });

  it('frees the lease after a failed generation', async () => {
    const a = await t.addUser('a@example.com');
    const conv = await newConv(a.userId);

    provider.script = { chunks: ['x'], failAfter: 0 };
    await send(a.headers, conv.id, 'first');
    provider.script = { chunks: ['ok'] };
    expect((await send(a.headers, conv.id, 'second')).statusCode).toBe(200);
  });

  it('gives messages a strictly increasing seq across conversations and reads them back in order', async () => {
    const a = await t.addUser('a@example.com');
    const { messages } = t.deps.repos;
    const one = await newConv(a.userId);
    const two = await newConv(a.userId);

    const seqs: number[] = [];
    for (let i = 0; i < 4; i++) {
      for (const conv of [one, two]) {
        const m = await messages.add({ conversationId: conv.id, role: 'user', content: `${conv === one ? 'one' : 'two'}-${i}` });
        seqs.push(m.seq);
      }
    }
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(new Set(seqs).size).toBe(seqs.length);

    expect((await messages.listPage(one.id)).rows.map((m) => m.content)).toEqual(['one-0', 'one-1', 'one-2', 'one-3']);
    expect((await messages.listRecent(one.id, 2)).map((m) => m.content)).toEqual(['one-2', 'one-3']);
    const page = await messages.listPage(two.id, 0, 3);
    expect(page.rows.map((m) => m.content)).toEqual(['two-0', 'two-1', 'two-2']);
    expect(page.hasMore).toBe(true);
  });

  it('pages through the conversation list without skipping or repeating', async () => {
    const a = await t.addUser('a@example.com');
    const created: string[] = [];
    for (let i = 0; i < 7; i++) created.push((await newConv(a.userId)).id); // fast inserts: timestamps may tie

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const q: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const res = await t.app.inject({ method: 'GET', url: `/v1/conversations?limit=2${q}`, headers: a.headers });
      const body = res.json() as { data: { id: string }[]; nextCursor: string | null };
      seen.push(...body.data.map((c) => c.id));
      cursor = body.nextCursor;
      if (!cursor) break;
    }

    expect(seen).toHaveLength(created.length);
    expect(new Set(seen)).toEqual(new Set(created));
  });

  it('ends on a full last page without an empty extra page, and rejects a bad cursor', async () => {
    const a = await t.addUser('a@example.com');
    for (let i = 0; i < 4; i++) await newConv(a.userId);
    const list = (q: string) => t.app.inject({ method: 'GET', url: `/v1/conversations?${q}`, headers: a.headers });

    const first = (await list('limit=2')).json();
    const second = (await list(`limit=2&cursor=${encodeURIComponent(first.nextCursor)}`)).json();
    expect(second.data).toHaveLength(2);
    expect(second.nextCursor).toBeNull();

    const bad = await list('cursor=not-a-cursor');
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('invalid_cursor');
  });
});
