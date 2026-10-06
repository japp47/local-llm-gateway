import { describe, it, expect } from 'vitest';
import { HeuristicTokenCounter } from '../src/lib/tokens.js';
import { buildContext, ContextTooLargeError } from '../src/services/context-builder.js';
import type { ChatMessage } from '../src/providers/types.js';

const counter = new HeuristicTokenCounter(3); // 3 chars per token, +4 per message
const msg = (role: 'user' | 'assistant', n: number): ChatMessage => ({
  role,
  content: 'x'.repeat(n),
});
const base = { counter, maxContextTokens: 120, reserveOutputTokens: 40 }; // budget 80

describe('buildContext', () => {
  it('keeps everything when it fits', () => {
    const r = buildContext({ ...base, history: [msg('user', 30), msg('assistant', 30)], userMessage: msg('user', 30) });
    expect(r.messages).toHaveLength(3);
    expect(r.droppedMessages).toBe(0);
  });

  it('drops the oldest messages first and keeps order', () => {
    const history = [msg('user', 60), msg('assistant', 11), msg('user', 60), msg('assistant', 11)];
    const r = buildContext({ ...base, history, userMessage: msg('user', 60) });
    expect(r.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(r.droppedMessages).toBe(2);
    expect(r.promptTokensEstimate).toBeLessThanOrEqual(r.budget);
  });

  it('never starts history with an orphaned assistant reply', () => {
    const history = [msg('user', 60), msg('assistant', 11), msg('user', 60), msg('assistant', 11)];
    const r = buildContext({ ...base, history, userMessage: msg('user', 60) });
    expect(r.messages[0]!.role).toBe('user');
  });

  it('always keeps the system prompt', () => {
    const r = buildContext({
      ...base,
      systemPrompt: 'be brief',
      history: [msg('user', 60), msg('assistant', 60), msg('user', 60)],
      userMessage: msg('user', 30),
    });
    expect(r.messages[0]).toEqual({ role: 'system', content: 'be brief' });
    expect(r.messages.at(-1)!.role).toBe('user');
  });

  it('throws when system prompt + new message alone exceed the budget', () => {
    expect(() => buildContext({ ...base, history: [], userMessage: msg('user', 600) })).toThrow(
      ContextTooLargeError,
    );
  });
});