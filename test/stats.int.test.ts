import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeProvider, makeTestApp } from './helpers.js';

type T = Awaited<ReturnType<typeof makeTestApp>>;

describe('GET /v1/stats', () => {
  let t: T;

  beforeEach(async () => {
    t = await makeTestApp(new FakeProvider());
  });
  afterEach(async () => {
    await t.close();
  });

  const gen = (userId: string, over: Record<string, unknown> = {}) =>
    t.deps.repos.generations.add({
      requestId: `req_${Math.random().toString(16).slice(2, 10)}`,
      userId,
      provider: 'ollama',
      model: 'fake-model',
      status: 'complete',
      promptTokens: 10,
      completionTokens: 20,
      queueWaitMs: 0,
      ttftMs: 100,
      generationMs: 1000,
      ...over,
    } as never);
  const stats = (headers: Record<string, string>, q = '') =>
    t.app.inject({ method: 'GET', url: `/v1/stats${q}`, headers });

  it('requires authentication', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/v1/stats' })).statusCode).toBe(401);
  });

  it('is empty when there is no usage', async () => {
    const a = await t.addUser('a@example.com');
    const body = (await stats(a.headers)).json();
    expect(body).toMatchObject({ hours: 24, models: [], recent: [] });
    expect(typeof body.since).toBe('string');
  });

  it('aggregates latency, tokens, throughput and outcomes per model', async () => {
    const a = await t.addUser('a@example.com');
    for (const ttft of [100, 200, 300, 400]) await gen(a.userId, { ttftMs: ttft, queueWaitMs: ttft / 100 });
    await gen(a.userId, { status: 'partial', errorCode: 'aborted', ttftMs: null, completionTokens: 5, generationMs: 500 });
    await gen(a.userId, { status: 'error', errorCode: 'provider_error', ttftMs: null, promptTokens: null, completionTokens: null, generationMs: null });
    await gen(a.userId, { model: 'other-model', ttftMs: 50 });

    const body = (await stats(a.headers)).json();
    const fake = body.models.find((m: any) => m.model === 'fake-model');
    expect(fake).toMatchObject({
      provider: 'ollama',
      requests: 6,
      complete: 4,
      partial: 1,
      errors: 1,
      promptTokens: 50,
      completionTokens: 85,
      avgTtftMs: 250,
      p50TtftMs: 250,
      p95TtftMs: 385,
    });
    expect(fake.avgTokPerSec).toBeCloseTo(18, 0); // four replies at 20 tok/s and one partial at 10 tok/s
    expect(body.models[0].model).toBe('fake-model'); // busiest first
    expect(body.models.find((m: any) => m.model === 'other-model')).toMatchObject({ requests: 1, p50TtftMs: 50 });
  });

  it("never includes another user's generations", async () => {
    const a = await t.addUser('a@example.com');
    const b = await t.addUser('b@example.com');
    await gen(a.userId);
    await gen(b.userId);
    await gen(b.userId);
    const body = (await stats(a.headers, '?recent=10')).json();
    expect(body.models[0].requests).toBe(1);
    expect(body.recent).toHaveLength(1);
  });

  it('respects the time window and lists recent generations newest first', async () => {
    const a = await t.addUser('a@example.com');
    await gen(a.userId, { requestId: 'req_old', createdAt: new Date(Date.now() - 5 * 3_600_000) });
    await gen(a.userId, { requestId: 'req_new1', createdAt: new Date(Date.now() - 60_000) });
    await gen(a.userId, { requestId: 'req_new2' });

    const narrow = (await stats(a.headers, '?hours=1&recent=5')).json();
    expect(narrow.models[0].requests).toBe(2);
    expect(narrow.recent.map((r: any) => r.requestId)).toEqual(['req_new2', 'req_new1']);

    const wide = (await stats(a.headers, '?hours=24&recent=1')).json();
    expect(wide.models[0].requests).toBe(3);
    expect(wide.recent).toHaveLength(1);

    expect((await stats(a.headers, '?recent=0')).json().recent).toEqual([]);
  });

  it('validates the query', async () => {
    const a = await t.addUser('a@example.com');
    for (const q of ['?hours=0', '?hours=721', '?hours=abc', '?recent=51', '?recent=-1']) {
      expect((await stats(a.headers, q)).statusCode, q).toBe(400);
    }
  });
});
