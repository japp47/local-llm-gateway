import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeProvider, makeTestApp } from './helpers.js';

type T = Awaited<ReturnType<typeof makeTestApp>>;

describe('long transcripts are paged, never silently cut off', () => {
  let t: T;

  beforeEach(async () => {
    t = await makeTestApp(new FakeProvider());
  });
  afterEach(async () => {
    await t.close();
  });

  it('returns every message across pages, with the total and a continuation marker', async () => {
    const a = await t.addUser('a@example.com');
    const conv = (await t.app.inject({ method: 'POST', url: '/v1/conversations', headers: a.headers, payload: {} })).json();
    for (let i = 1; i <= 7; i++) {
      await t.deps.repos.messages.add({ conversationId: conv.id, role: i % 2 ? 'user' : 'assistant', content: `m${i}` });
    }
    const page = (q: string) => t.app.inject({ method: 'GET', url: `/v1/conversations/${conv.id}?${q}`, headers: a.headers });

    const p1 = (await page('limit=3')).json();
    expect(p1.messages.map((m: any) => m.content)).toEqual(['m1', 'm2', 'm3']);
    expect(p1.messageCount).toBe(7);
    expect(p1.nextAfter).toBe(p1.messages[2].seq);

    const p2 = (await page(`limit=3&after=${p1.nextAfter}`)).json();
    expect(p2.messages.map((m: any) => m.content)).toEqual(['m4', 'm5', 'm6']);

    const p3 = (await page(`limit=3&after=${p2.nextAfter}`)).json();
    expect(p3.messages.map((m: any) => m.content)).toEqual(['m7']);
    expect(p3.nextAfter).toBeNull();
  });

  it('a conversation over the old 500-message cap comes back complete when paged', async () => {
    const a = await t.addUser('a@example.com');
    const conv = (await t.app.inject({ method: 'POST', url: '/v1/conversations', headers: a.headers, payload: {} })).json();
    for (let i = 1; i <= 520; i++) {
      await t.deps.repos.messages.add({ conversationId: conv.id, role: i % 2 ? 'user' : 'assistant', content: `m${i}` });
    }

    const first = (await t.app.inject({ method: 'GET', url: `/v1/conversations/${conv.id}`, headers: a.headers })).json();
    expect(first.messages).toHaveLength(500);
    expect(first.messageCount).toBe(520);
    expect(first.nextAfter).not.toBeNull();

    const rest = (await t.app.inject({ method: 'GET', url: `/v1/conversations/${conv.id}?after=${first.nextAfter}`, headers: a.headers })).json();
    expect(rest.messages.map((m: any) => m.content)).toEqual(Array.from({ length: 20 }, (_, i) => `m${501 + i}`));
    expect(rest.nextAfter).toBeNull();
  });

  it('validates the paging parameters', async () => {
    const a = await t.addUser('a@example.com');
    const conv = (await t.app.inject({ method: 'POST', url: '/v1/conversations', headers: a.headers, payload: {} })).json();
    const bad = await t.app.inject({ method: 'GET', url: `/v1/conversations/${conv.id}?limit=0`, headers: a.headers });
    expect(bad.statusCode).toBe(400);
    const empty = (await t.app.inject({ method: 'GET', url: `/v1/conversations/${conv.id}`, headers: a.headers })).json();
    expect(empty).toMatchObject({ messages: [], messageCount: 0, nextAfter: null });
  });
});
