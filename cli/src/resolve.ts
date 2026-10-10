import type { ApiClient, Message } from './api.js';
import { CliError } from './errors.js';
import { shortId } from './format.js';
import { PREFIX_RE, UUID_RE } from './utils/constants.js';

export type PrefixMatch = { kind: 'one'; id: string } | { kind: 'none' } | { kind: 'many'; ids: string[] };

export function matchPrefix(ids: string[], ref: string): PrefixMatch {
  const needle = ref.toLowerCase();
  const hits = ids.filter((id) => id.startsWith(needle));
  if (hits.length === 1) return { kind: 'one', id: hits[0]! };
  return hits.length === 0 ? { kind: 'none' } : { kind: 'many', ids: hits };
}

/** Accepts a full id, a unique prefix (4+ hex chars), or "latest". */
export async function resolveConversationId(
  client: Pick<ApiClient, 'listConversations'>,
  ref: string,
): Promise<string> {
  const r = ref.trim();
  if (r === 'latest' || r === 'last') {
    const { data } = await client.listConversations(1);
    if (!data[0]) throw new CliError('No conversations yet. Start one with: llm chat');
    return data[0].id;
  }
  if (UUID_RE.test(r)) return r.toLowerCase();
  if (!PREFIX_RE.test(r)) {
    throw new CliError(`"${r}" is not a conversation id. Use a full id, a prefix (4+ hex chars), or "latest".`);
  }
  const { data } = await client.listConversations(100);
  const m = matchPrefix(data.map((c) => c.id), r);
  if (m.kind === 'one') return m.id;
  if (m.kind === 'none') throw new CliError(`No conversation starts with "${r}". See: llm ls`);
  throw new CliError(`"${r}" is ambiguous (${m.ids.map(shortId).join(', ')}). Use more characters.`);
}

export interface MessageRef {
  message: Message;
  index: number; // 1-based, as shown by `llm show`
}

/** Default: the last assistant reply. Otherwise a 1-based number or a full message id. */
export function resolveMessageRef(messages: Message[], ref?: string): MessageRef {
  if (messages.length === 0) throw new CliError('This conversation has no messages to fork from.');
  if (ref === undefined || ref === '') {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.role === 'assistant' && m.status !== 'error') return { message: m, index: i + 1 };
    }
    throw new CliError('There is no assistant reply to fork from yet. Pass --from <n> to pick a message.');
  }
  let found: MessageRef | undefined;
  if (/^\d+$/.test(ref)) {
    const n = Number(ref);
    const m = messages[n - 1];
    if (!m) throw new CliError(`No message #${n} (this conversation has ${messages.length}).`);
    found = { message: m, index: n };
  } else if (UUID_RE.test(ref)) {
    const i = messages.findIndex((m) => m.id === ref.toLowerCase());
    if (i < 0) throw new CliError('That message id is not in this conversation.');
    found = { message: messages[i]!, index: i + 1 };
  } else {
    throw new CliError(`"${ref}" is not a message number or id.`);
  }
  if (found.message.role !== 'user' && found.message.role !== 'assistant') {
    throw new CliError(`Message #${found.index} is a ${found.message.role} message; fork from a user or assistant message.`);
  }
  return found;
}