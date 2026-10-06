import type { TokenCounter } from '../lib/tokens.js';
import type { ChatMessage } from '../providers/types.js';

const PER_MESSAGE_OVERHEAD = 4; // role markers / template tokens per message

export class ContextTooLargeError extends Error {
  constructor(
    readonly needed: number,
    readonly budget: number,
  ) {
    super(`system prompt + message need ${needed} tokens, budget is ${budget}`);
  }
}

export interface BuildContextInput {
  systemPrompt?: string | null;
  history: ChatMessage[]; // chronological, excluding the new user message
  userMessage: ChatMessage;
  maxContextTokens: number;
  reserveOutputTokens: number;
  counter: TokenCounter;
}

export interface BuiltContext {
  messages: ChatMessage[];
  promptTokensEstimate: number;
  budget: number;
  droppedMessages: number;
}

export function buildContext(i: BuildContextInput): BuiltContext {
  const cost = (m: ChatMessage) => i.counter.count(m.content) + PER_MESSAGE_OVERHEAD;
  const budget = i.maxContextTokens - i.reserveOutputTokens;

  const system: ChatMessage[] = i.systemPrompt
    ? [{ role: 'system', content: i.systemPrompt }]
    : [];
  const fixed = [...system, i.userMessage].reduce((n, m) => n + cost(m), 0);
  if (fixed > budget) throw new ContextTooLargeError(fixed, budget);

  // Walk history newest -> oldest, keep what fits.
  let used = fixed;
  const picked: ChatMessage[] = [];
  for (let k = i.history.length - 1; k >= 0; k--) {
    const m = i.history[k]!;
    const c = cost(m);
    if (used + c > budget) break;
    used += c;
    picked.unshift(m);
  }
  // Never start history with an orphaned assistant reply.
  while (picked[0]?.role === 'assistant') {
    used -= cost(picked[0]);
    picked.shift();
  }

  return {
    messages: [...system, ...picked, i.userMessage],
    promptTokensEstimate: used,
    budget,
    droppedMessages: i.history.length - picked.length,
  };
}