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
