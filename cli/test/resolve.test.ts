import { describe, expect, it } from 'vitest';
import type { Message } from '../src/api.js';
import { CliError } from '../src/errors.js';
import { matchPrefix, resolveConversationId, resolveMessageRef } from '../src/resolve.js';

const A = '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = '11112222-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('matchPrefix', () => {
  it('finds one, none, or many', () => {
    expect(matchPrefix([A, B, C], 'cccc')).toEqual({ kind: 'one', id: C });
    expect(matchPrefix([A, B, C], '1111')).toEqual({ kind: 'many', ids: [A, B] });
    expect(matchPrefix([A, B, C], 'ffff')).toEqual({ kind: 'none' });
    expect(matchPrefix([A, B, C], '11111111-A')).toEqual({ kind: 'one', id: A });
  });
});

describe('resolveConversationId', () => {
  const fake = (ids: string[]) => ({
    listConversations: async (limit = 20) => ({
      data: ids.slice(0, limit).map((id) => ({ id }) as never),
      nextBefore: null,
    }),
  });
  it('resolves latest, full ids and unique prefixes', async () => {
    expect(await resolveConversationId(fake([B, A]), 'latest')).toBe(B);
    expect(await resolveConversationId(fake([]), A.toUpperCase())).toBe(A);
    expect(await resolveConversationId(fake([A, B, C]), 'cccc')).toBe(C);
  });
  it('explains ambiguity, misses and nonsense', async () => {
    await expect(resolveConversationId(fake([A, B]), '1111')).rejects.toThrow(/ambiguous/);
    await expect(resolveConversationId(fake([A]), 'ffff')).rejects.toThrow(/No conversation starts with/);
    await expect(resolveConversationId(fake([]), 'latest')).rejects.toThrow(/No conversations yet/);
    await expect(resolveConversationId(fake([A]), 'zzzz')).rejects.toBeInstanceOf(CliError);
  });
});

describe('resolveMessageRef', () => {
  const m = (n: number, role: Message['role'], status: Message['status'] = 'complete'): Message => ({
    id: `00000000-0000-4000-8000-00000000000${n}`, role, content: `m${n}`, status, model: null, createdAt: '',
  });
  const msgs = [m(1, 'user'), m(2, 'assistant'), m(3, 'user'), m(4, 'assistant', 'error')];

  it('defaults to the last healthy assistant reply', () => {
    expect(resolveMessageRef(msgs).index).toBe(2);
  });
  it('accepts 1-based numbers and full ids', () => {
    expect(resolveMessageRef(msgs, '3').message.content).toBe('m3');
    expect(resolveMessageRef(msgs, msgs[1]!.id).index).toBe(2);
  });
  it('rejects bad references with helpful errors', () => {
    expect(() => resolveMessageRef(msgs, '9')).toThrow(/No message #9/);
    expect(() => resolveMessageRef(msgs, 'abc')).toThrow(/not a message number/);
    expect(() => resolveMessageRef([], undefined)).toThrow(/no messages/);
    expect(() => resolveMessageRef([m(1, 'user')], undefined)).toThrow(/no assistant reply/);
    expect(() => resolveMessageRef([m(1, 'system')], '1')).toThrow(/system message/);
  });
});