import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generations } from '../src/db/schema.js';
import { FakeProvider, makeTestApp, parseSse } from './helpers.js';

type T = Awaited<ReturnType<typeof makeTestApp>>;

describe('conversations API', () => {
  let t: T;
  let provider: FakeProvider;

  const setup = async (env: Record<string, string> = {}) => {
    provider = new FakeProvider();
    t = await makeTestApp(provider, env);
  };
  afterEach(async () => {
    await t.close();
  });

  const create = async (headers: Record<string, string>, body: object = {}) => {
    const res = await t.app.inject({ method: 'POST', url: '/v1/conversations', headers, payload: body });
    return res.json() as { id: string };
  };
  const send = (headers: Record<string, string>, id: string, content: string, extra: object = {}) =>
    t.app.inject({
      method: 'POST',
      url: `/v1/conversations/${id}/messages`,
      headers,
      payload: { content, ...extra },
    });

  describe('auth and basics', () => {
    beforeEach(() => setup());

    it('rejects missing and invalid keys, and always returns a request id', async () => {
      const none = await t.app.inject({ method: 'GET', url: '/v1/conversations' });
      expect(none.statusCode).toBe(401);
      expect(none.headers['x-request-id']).toMatch(/^req_/);

      const bad = await t.app.inject({
        method: 'GET',
        url: '/v1/conversations',
        headers: { authorization: 'Bearer nope' },
      });
      expect(bad.statusCode).toBe(401);
      expect(bad.json().error.code).toBe('invalid_api_key');
    });

    it('creates, lists, renames and deletes a conversation', async () => {
      const a = await t.addUser('a@example.com');
      const conv = await create(a.headers, { title: 'First' });

      const list = await t.app.inject({ method: 'GET', url: '/v1/conversations', headers: a.headers });
      expect(list.json().data).toHaveLength(1);

      const renamed = await t.app.inject({
        method: 'PATCH',
        url: `/v1/conversations/${conv.id}`,
        headers: a.headers,
        payload: { title: 'Renamed' },
      });
      expect(renamed.json().title).toBe('Renamed');

      const del = await t.app.inject({ method: 'DELETE', url: `/v1/conversations/${conv.id}`, headers: a.headers });
      expect(del.statusCode).toBe(204);
      const gone = await t.app.inject({ method: 'GET', url: `/v1/conversations/${conv.id}`, headers: a.headers });
      expect(gone.statusCode).toBe(404);
    });

    it('validates ids, bodies and models', async () => {
      const a = await t.addUser('a@example.com');
      const badId = await t.app.inject({ method: 'GET', url: '/v1/conversations/not-a-uuid', headers: a.headers });
      expect(badId.statusCode).toBe(400);

      const conv = await create(a.headers);
      const empty = await send(a.headers, conv.id, '');
      expect(empty.statusCode).toBe(400);

      const model = await t.app.inject({
        method: 'POST',
        url: '/v1/conversations',
        headers: a.headers,
        payload: { model: 'some-huge-model' },
      });
      expect(model.statusCode).toBe(400);
      expect(model.json().error.code).toBe('model_not_allowed');
    });

    it("keeps one user out of another user's conversations", async () => {
      const a = await t.addUser('a@example.com');
      const b = await t.addUser('b@example.com');
      const conv = await create(a.headers, { title: 'private' });

      expect((await t.app.inject({ method: 'GET', url: `/v1/conversations/${conv.id}`, headers: b.headers })).statusCode).toBe(404);
      expect((await send(b.headers, conv.id, 'hi')).statusCode).toBe(404);
      expect((await t.app.inject({ method: 'DELETE', url: `/v1/conversations/${conv.id}`, headers: b.headers })).statusCode).toBe(404);
      const list = await t.app.inject({ method: 'GET', url: '/v1/conversations', headers: b.headers });
      expect(list.json().data).toHaveLength(0);
    });
  });

  describe('sending messages', () => {
    beforeEach(() => setup());

    it('streams a reply, persists both messages, and records a generation', async () => {
      provider.script = { chunks: ['Hello', ' world'], usage: { promptTokens: 9, completionTokens: 2 } };
      const a = await t.addUser('a@example.com');
      const conv = await create(a.headers);

      const res = await send(a.headers, conv.id, 'say hello');
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      const requestId = res.headers['x-request-id'] as string;

      const events = parseSse(res.payload);
      expect(events.map((e) => e.event)).toEqual(['start', 'delta', 'delta', 'meta', 'done']);
      expect(events[0]!.data.requestId).toBe(requestId);
      const meta = events.find((e) => e.event === 'meta')!.data;
      expect(meta).toMatchObject({ provider: 'fake', promptTokens: 9, completionTokens: 2, usageSource: 'provider' });
      expect(events.at(-1)!.data.status).toBe('complete');

      const full = await t.app.inject({ method: 'GET', url: `/v1/conversations/${conv.id}`, headers: a.headers });
      const body = full.json();
      expect(body.title).toBe('say hello');
      expect(body.messages.map((m: any) => [m.role, m.content, m.status])).toEqual([
        ['user', 'say hello', 'complete'],
        ['assistant', 'Hello world', 'complete'],
      ]);

      const rows = await t.deps.db.select().from(generations).where(eq(generations.requestId, requestId));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ provider: 'fake', model: 'fake-model', status: 'complete', promptTokens: 9 });
      expect(rows[0]!.messageId).toBe(body.messages[1].id);
    });

    it('sends prior turns to the provider on the next message', async () => {
      const a = await t.addUser('a@example.com');
      const conv = await create(a.headers);
      await send(a.headers, conv.id, 'first');
      await send(a.headers, conv.id, 'second');

      expect(provider.calls[1]!.messages.map((m) => [m.role, m.content])).toEqual([
        ['user', 'first'],
        ['assistant', 'Hello world'],
        ['user', 'second'],
      ]);
    });

    it('includes the conversation system prompt', async () => {
      const a = await t.addUser('a@example.com');
      const conv = await create(a.headers, { systemPrompt: 'be brief' });
      await send(a.headers, conv.id, 'hi');
      expect(provider.calls[0]!.messages[0]).toEqual({ role: 'system', content: 'be brief' });
    });

    it('uses a per-message model override', async () => {
      const a = await t.addUser('a@example.com');
      const conv = await create(a.headers);
      await send(a.headers, conv.id, 'hi', { model: 'other-model' });
      expect(provider.calls[0]!.model).toBe('other-model');
      const full = await t.app.inject({ method: 'GET', url: `/v1/conversations/${conv.id}`, headers: a.headers });
      expect(full.json().messages[1].model).toBe('other-model');
      expect(full.json().defaultModel).toBe('fake-model');
    });

    it('returns 409 while a generation is already running in the conversation', async () => {
      const a = await t.addUser('a@example.com');
      const conv = await create(a.headers);
      provider.hold();

      const first = send(a.headers, conv.id, 'slow one');
      await provider.started; // lease is held by now
      const second = await send(a.headers, conv.id, 'impatient');
      expect(second.statusCode).toBe(409);
      expect(second.json().error.code).toBe('conversation_busy');

      provider.release();
      expect((await first).statusCode).toBe(200);
      expect((await send(a.headers, conv.id, 'now fine')).statusCode).toBe(200); // lease released
    });

    it('saves a partial assistant message when the provider fails midway', async () => {
      provider.script = { chunks: ['Hel', 'lo', '!'], failAfter: 2 };
      const a = await t.addUser('a@example.com');
      const conv = await create(a.headers);

      const res = await send(a.headers, conv.id, 'hi');
      const events = parseSse(res.payload);
      expect(events.some((e) => e.event === 'error')).toBe(true);
      expect(events.at(-1)!.data.status).toBe('partial');

      const full = await t.app.inject({ method: 'GET', url: `/v1/conversations/${conv.id}`, headers: a.headers });
      expect(full.json().messages[1]).toMatchObject({ content: 'Hello', status: 'partial' });
      const rows = await t.deps.db.select().from(generations);
      expect(rows[0]).toMatchObject({ status: 'partial', errorCode: 'internal_error' });
    });
  });

  describe('context window', () => {
    it('drops the oldest turns once the token budget is exceeded', async () => {
      await setup({ MODEL_CONTEXT_TOKENS: '120', RESERVE_OUTPUT_TOKENS: '40' }); // budget 80
      const a = await t.addUser('a@example.com');
      const conv = await create(a.headers);
      const long = 'x'.repeat(60);

      await send(a.headers, conv.id, long);
      await send(a.headers, conv.id, long);
      const res = await send(a.headers, conv.id, long);

      expect(provider.calls[2]!.messages).toHaveLength(3);
      const meta = parseSse(res.payload).find((e) => e.event === 'meta')!.data;
      expect(meta.droppedMessages).toBe(2);
    });

    it('returns 413 when one message cannot fit at all', async () => {
      await setup();
      const a = await t.addUser('a@example.com');
      const conv = await create(a.headers);
      const res = await send(a.headers, conv.id, 'x'.repeat(12_000));
      expect(res.statusCode).toBe(413);
      expect(res.json().error.code).toBe('context_too_large');
      const full = await t.app.inject({ method: 'GET', url: `/v1/conversations/${conv.id}`, headers: a.headers });
      expect(full.json().messages).toHaveLength(0); // nothing persisted on rejection
    });
  });

  describe('rate limiting', () => {
    it('limits per api key, not globally', async () => {
      await setup({ RATE_LIMIT_MAX: '3' });
      const a = await t.addUser('a@example.com');
      const b = await t.addUser('b@example.com');
      const get = (h: Record<string, string>) =>
        t.app.inject({ method: 'GET', url: '/v1/conversations', headers: h });

      const codes: number[] = [];
      for (let i = 0; i < 4; i++) codes.push((await get(a.headers)).statusCode);
      expect(codes).toEqual([200, 200, 200, 429]);
      expect((await get(b.headers)).statusCode).toBe(200);
    });
  });
});
