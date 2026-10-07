import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeProvider, makeTestApp } from './helpers.js';

type T = Awaited<ReturnType<typeof makeTestApp>>;
type Headers = Record<string, string>;

describe('conversation forks', () => {
  let t: T;
  let provider: FakeProvider;

  beforeEach(async () => {
    provider = new FakeProvider();
    t = await makeTestApp(provider);
  });
  afterEach(async () => {
    await t.close();
  });

  const create = async (headers: Headers, body: object = {}) =>
    (await t.app.inject({ method: 'POST', url: '/v1/conversations', headers, payload: body })).json() as { id: string };
  const send = (headers: Headers, id: string, content: string) =>
    t.app.inject({ method: 'POST', url: `/v1/conversations/${id}/messages`, headers, payload: { content } });
  const get = async (headers: Headers, id: string) =>
    (await t.app.inject({ method: 'GET', url: `/v1/conversations/${id}`, headers })).json();
  const fork = (headers: Headers, id: string, body: object) =>
    t.app.inject({ method: 'POST', url: `/v1/conversations/${id}/forks`, headers, payload: body });

  /** A conversation with two full turns: user1, assistant1, user2, assistant2. */
  const twoTurns = async (headers: Headers, body: object = { title: 'Design talk' }) => {
    const conv = await create(headers, body);
    await send(headers, conv.id, 'first question');
    await send(headers, conv.id, 'second question');
    const full = await get(headers, conv.id);
    return { conv, messages: full.messages as { id: string; role: string; content: string }[] };
  };

  it('copies history up to and including the chosen message and links back to its source', async () => {
    const a = await t.addUser('a@example.com');
    const { conv, messages } = await twoTurns(a.headers);

    const res = await fork(a.headers, conv.id, { fromMessageId: messages[1]!.id }); // first assistant reply
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      parentConversationId: conv.id,
      forkedFromMessageId: messages[1]!.id,
      messageCount: 2,
      title: 'Design talk (branch)',
      defaultModel: 'fake-model',
    });

    const forked = await get(a.headers, body.id);
    expect(forked.messages.map((m: any) => [m.role, m.content])).toEqual([
      ['user', 'first question'],
      ['assistant', 'Hello world'],
    ]);
    expect((await get(a.headers, conv.id)).messages).toHaveLength(4); // the source is untouched
  });

  it('lets the branch continue on its own, seeing only the copied history', async () => {
    const a = await t.addUser('a@example.com');
    const { conv, messages } = await twoTurns(a.headers);
    const branch = (await fork(a.headers, conv.id, { fromMessageId: messages[1]!.id })).json();

    provider.calls = [];
    await send(a.headers, branch.id, 'a different follow-up');

    expect(provider.calls[0]!.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'first question'],
      ['assistant', 'Hello world'],
      ['user', 'a different follow-up'],
    ]);
    expect((await get(a.headers, branch.id)).messages).toHaveLength(4);
    expect((await get(a.headers, conv.id)).messages).toHaveLength(4); // source did not grow
  });

  it('keeps the system prompt and accepts a custom title and model', async () => {
    const a = await t.addUser('a@example.com');
    const { conv, messages } = await twoTurns(a.headers, { systemPrompt: 'be brief' });
    const res = await fork(a.headers, conv.id, {
      fromMessageId: messages[3]!.id,
      title: 'Try the other model',
      defaultModel: 'other-model',
    });
    expect(res.json()).toMatchObject({
      systemPrompt: 'be brief',
      title: 'Try the other model',
      defaultModel: 'other-model',
      messageCount: 4,
    });
  });

  it('rejects models that are not allowed', async () => {
    const a = await t.addUser('a@example.com');
    const { conv, messages } = await twoTurns(a.headers);
    const res = await fork(a.headers, conv.id, { fromMessageId: messages[1]!.id, defaultModel: 'huge-model' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('model_not_allowed');
  });

  it('returns 404 for unknown conversations, other users, foreign messages and empty conversations', async () => {
    const a = await t.addUser('a@example.com');
    const b = await t.addUser('b@example.com');
    const { conv, messages } = await twoTurns(a.headers);
    const other = await twoTurns(a.headers, { title: 'other' });
    const empty = await create(a.headers);

    const missing = await fork(a.headers, '00000000-0000-4000-8000-000000000000', { fromMessageId: messages[0]!.id });
    expect(missing.json().error.code).toBe('conversation_not_found');

    const stranger = await fork(b.headers, conv.id, { fromMessageId: messages[0]!.id });
    expect(stranger.statusCode).toBe(404);
    expect(stranger.json().error.code).toBe('conversation_not_found');

    const foreign = await fork(a.headers, conv.id, { fromMessageId: other.messages[0]!.id });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error.code).toBe('message_not_found');

    const nothing = await fork(a.headers, empty.id, { fromMessageId: messages[0]!.id });
    expect(nothing.json().error.code).toBe('message_not_found');
  });

  it('validates ids and the request body', async () => {
    const a = await t.addUser('a@example.com');
    const { conv } = await twoTurns(a.headers);
    expect((await fork(a.headers, conv.id, {})).statusCode).toBe(400);
    expect((await fork(a.headers, conv.id, { fromMessageId: 'nope' })).statusCode).toBe(400);
    expect((await fork(a.headers, 'not-a-uuid', { fromMessageId: '00000000-0000-4000-8000-000000000000' })).statusCode).toBe(400);
  });

  it('keeps a branch alive, detached from its parent, when the parent is deleted', async () => {
    const a = await t.addUser('a@example.com');
    const { conv, messages } = await twoTurns(a.headers);
    const branch = (await fork(a.headers, conv.id, { fromMessageId: messages[1]!.id })).json();

    const del = await t.app.inject({ method: 'DELETE', url: `/v1/conversations/${conv.id}`, headers: a.headers });
    expect(del.statusCode).toBe(204);

    const after = await get(a.headers, branch.id);
    expect(after.parentConversationId).toBeNull();
    expect(after.forkedFromMessageId).toBeNull();
    expect(after.messages).toHaveLength(2);
  });
});
