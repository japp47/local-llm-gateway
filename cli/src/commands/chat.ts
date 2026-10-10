import { ApiError } from '../api.js';
import { loadConfig } from '../config.js';
import { CliError } from '../errors.js';
import { formatMessage, out, shortId } from '../format.js';
import { printSummary, runRepl } from '../repl.js';
import { resolveConversationId } from '../resolve.js';
import { getClient, readStdin } from './shared.js';

export interface ChatOptions {
  model?: string;
  system?: string;
  title?: string;
  quiet?: boolean;
}

export async function chatCommand(messageParts: string[], opts: ChatOptions): Promise<void> {
  const client = getClient();
  const model = opts.model ?? loadConfig().model;
  let content = messageParts.join(' ').trim();
  if (content === '-') content = (await readStdin()).trim();

  const newConversation = { title: opts.title, model, systemPrompt: opts.system };

  // Interactive session: the conversation is created with the first message.
  if (!content) {
    console.log(out.dim(`Chatting with ${model ?? 'the default model'}. /help for commands, /exit to quit.`));
    await runRepl({ client, newConversation, quiet: opts.quiet });
    return;
  }

  // One-shot: the answer goes to stdout, everything else to stderr (pipe-friendly).
  const conv = await client.createConversation(newConversation);
  try {
    const res = await client.streamMessage(conv.id, { content }, { onDelta: (t) => process.stdout.write(t) });
    process.stdout.write('\n');
    const ok = printSummary(res, opts.quiet ?? false);
    console.error(out.dim(`  conversation ${shortId(conv.id)} — continue with: llm resume ${shortId(conv.id)}`));
    if (!ok) process.exitCode = 1;
  } catch (e) {
    if (e instanceof ApiError) await client.deleteConversation(conv.id).catch(() => {});
    throw e;
  }
}

export async function resumeCommand(ref: string, opts: { model?: string; tail: string; quiet?: boolean }): Promise<void> {
  const client = getClient();
  const id = await resolveConversationId(client, ref);
  const t = await client.getConversation(id);
  const tail = Number(opts.tail);
  if (!Number.isInteger(tail) || tail < 0) throw new CliError('--tail must be a non-negative integer');

  console.log(out.bold(t.title ?? '(untitled)') + out.dim(`  ${shortId(t.id)}  [${t.defaultModel}]`));
  const start = Math.max(0, t.messages.length - tail);
  if (start > 0) console.log(out.dim(`  … ${start} earlier message(s) — see them with: llm show ${shortId(t.id)}`));
  for (let i = start; i < t.messages.length; i++) console.log(formatMessage(t.messages[i]!, i + 1, out));
  console.log('');
  await runRepl({ client, conversationId: id, model: opts.model, quiet: opts.quiet });
}