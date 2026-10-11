import { createInterface } from 'node:readline/promises';
import { CliError } from '../errors.js';
import { formatMessage, out, relativeTime, renderTable, shortId, truncate } from '../format.js';
import { resolveConversationId, resolveMessageRef } from '../resolve.js';
import { getClient } from './shared.js';

export async function lsCommand(opts: { limit: string; json?: boolean }): Promise<void> {
  const client = getClient();
  const limit = Number(opts.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new CliError('--limit must be between 1 and 100');
  const { data } = await client.listConversations(limit);
  if (opts.json) return void console.log(JSON.stringify(data, null, 2));
  if (data.length === 0) return void console.log(out.dim('No conversations yet. Start one with: llm chat'));

  const [head, ...rows] = renderTable(
    ['ID', 'TITLE', 'MODEL', 'UPDATED', 'BRANCH OF'],
    data.map((c) => [
      shortId(c.id),
      truncate(c.title ?? '(untitled)', 40),
      c.defaultModel,
      relativeTime(c.updatedAt),
      c.parentConversationId ? shortId(c.parentConversationId) : '',
    ]),
  );
  console.log(out.dim(head!));
  console.log(rows.join('\n'));
}

export async function showCommand(ref: string, opts: { last?: string; json?: boolean }): Promise<void> {
  const client = getClient();
  const t = await client.getConversation(await resolveConversationId(client, ref));
  if (opts.json) return void console.log(JSON.stringify(t, null, 2));

  console.log(out.bold(t.title ?? '(untitled)'));
  console.log(out.dim(`${t.id}  [${t.defaultModel}]  updated ${relativeTime(t.updatedAt)}`));
  if (t.parentConversationId) {
    console.log(out.dim(`branch of ${shortId(t.parentConversationId)}`));
  }
  if (t.systemPrompt) console.log(out.dim(`system: ${truncate(t.systemPrompt, 100)}`));
  console.log('');
  const last = opts.last ? Number(opts.last) : t.messages.length;
  const start = Math.max(0, t.messages.length - (Number.isInteger(last) && last > 0 ? last : t.messages.length));
  for (let i = start; i < t.messages.length; i++) console.log(formatMessage(t.messages[i]!, i + 1, out) + '\n');
  if (t.messages.length === 0) console.log(out.dim('(no messages)'));
}

export async function renameCommand(ref: string, titleParts: string[]): Promise<void> {
  const client = getClient();
  const title = titleParts.join(' ').trim();
  if (!title) throw new CliError('Usage: llm rename <id> <new title>');
  const c = await client.renameConversation(await resolveConversationId(client, ref), title);
  console.log(`Renamed ${shortId(c.id)} → ${c.title}`);
}

export async function rmCommand(ref: string, opts: { yes?: boolean }): Promise<void> {
  const client = getClient();
  const id = await resolveConversationId(client, ref);
  if (!opts.yes) {
    if (!process.stdin.isTTY) throw new CliError('Refusing to delete without confirmation. Re-run with --yes.');
    const t = await client.getConversation(id);
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const answer = await rl.question(`Delete "${t.title ?? '(untitled)'}" (${shortId(id)}, ${t.messages.length} messages)? [y/N] `);
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) return void console.log('Cancelled.');
  }
  await client.deleteConversation(id);
  console.log(`Deleted ${shortId(id)}.`);
}

export async function forkCommand(
  ref: string,
  opts: { from?: string; title?: string; model?: string; chat?: boolean; quiet?: boolean },
): Promise<void> {
  const client = getClient();
  const id = await resolveConversationId(client, ref);
  const t = await client.getConversation(id);
  const anchor = resolveMessageRef(t.messages, opts.from);

  const forked = await client.forkConversation(id, {
    fromMessageId: anchor.message.id,
    title: opts.title,
    defaultModel: opts.model,
  });
  console.log(`Forked ${shortId(id)} after message #${anchor.index} → ${out.bold(shortId(forked.id))} (${forked.messageCount} messages copied)`);
  if (anchor.message.role === 'user') {
    console.log(out.dim('Note: the branch ends on a user message, so your next prompt will follow it directly.'));
  }
  if (opts.chat) {
    const { runRepl } = await import('../repl.js');
    await runRepl({ client, conversationId: forked.id, quiet: opts.quiet });
  } else {
    console.log(out.dim(`Continue with: llm resume ${shortId(forked.id)}`));
  }
}