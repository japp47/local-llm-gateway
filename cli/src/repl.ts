import { createInterface } from 'node:readline';
import { ApiClient, ApiError, type StreamMeta, type StreamResult } from './api.js';
import { CliError, describeError } from './errors.js';
import { errc, formatMessage, formatMetaLine, out, shortId, tokPerSec } from './format.js';
import { resolveConversationId, resolveMessageRef } from './resolve.js';
import { HELP } from './utils/constants.js';

export interface ReplOptions {
  client: ApiClient;
  /** Existing conversation to continue. Omit to create one lazily on the first message. */
  conversationId?: string;
  newConversation?: { title?: string; model?: string; systemPrompt?: string };
  /** Per-message model override (the conversation keeps its own default). */
  model?: string;
  quiet?: boolean;
}

/** Prints cancellation/errors/metrics to stderr. Returns true when the reply completed normally. */
export function printSummary(res: StreamResult, quiet: boolean): boolean {
  let ok = true;
  if (res.aborted) {
    console.error(errc.yellow('⚠ cancelled — the partial reply was saved.'));
    ok = false;
  } else if (res.error) {
    console.error(errc.red(`✗ generation failed (${res.error.code}).${res.text ? ' The partial reply was saved.' : ''}`));
    ok = false;
  } else if (res.incomplete) {
    console.error(errc.yellow('⚠ the stream ended unexpectedly; the reply may be incomplete.'));
    ok = false;
  }
  if (res.meta && !quiet) {
    console.error('  ' + formatMetaLine(res.meta, errc));
    if (res.meta.droppedMessages > 0) {
      console.error(errc.yellow(`  ⚠ ${res.meta.droppedMessages} older message(s) did not fit and were left out of the context.`));
    }
  }
  return ok;
}

export async function runRepl(opts: ReplOptions): Promise<void> {
  const { client } = opts;
  let conversationId = opts.conversationId;
  let pendingTitle = opts.newConversation?.title;
  let modelOverride = opts.model;
  let lastMeta: StreamMeta | undefined;
  let inflight: AbortController | null = null;
  let exitArmed = false;

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY === true });
  const promptText = () => out.cyan(modelOverride ? `you (${modelOverride}) › ` : 'you › ');

  rl.on('SIGINT', () => {
    if (inflight) {
      inflight.abort(); // cancel the stream; the server saves what was generated so far
      return;
    }
    if (rl.line.length > 0) {
      rl.write(null, { ctrl: true, name: 'u' }); // first Ctrl-C clears the line
      return;
    }
    if (exitArmed) {
      rl.close();
      return;
    }
    exitArmed = true;
    process.stdout.write(out.dim('\n(press Ctrl-C again, or type /exit, to quit)\n'));
    rl.prompt();
    setTimeout(() => (exitArmed = false), 3000).unref();
  });

  async function ensureConversation(): Promise<string> {
    if (conversationId) return conversationId;
    const base = opts.newConversation ?? {};
    const conv = await client.createConversation({ ...base, title: pendingTitle ?? base.title });
    conversationId = conv.id;
    return conv.id;
  }

  async function turn(content: string): Promise<void> {
    const created = !conversationId;
    const id = await ensureConversation();
    const ac = new AbortController();
    inflight = ac;
    try {
      const res = await client.streamMessage(
        id,
        { content, model: modelOverride },
        {
          onStart: () => process.stdout.write(out.green('assistant › ')),
          onDelta: (t) => process.stdout.write(t),
        },
        ac.signal,
      );
      process.stdout.write('\n');
      if (res.meta) lastMeta = res.meta;
      printSummary(res, opts.quiet ?? false);
      process.stdout.write('\n');
    } catch (e) {
      // A rejected first message must not leave an empty conversation behind.
      if (created && e instanceof ApiError) {
        await client.deleteConversation(id).catch(() => {});
        conversationId = undefined;
      }
      throw e;
    } finally {
      inflight = null;
    }
  }

  async function slash(line: string): Promise<boolean> {
    const [cmd = '', ...rest] = line.slice(1).split(/\s+/);
    const arg = rest.join(' ').trim();
    switch (cmd.toLowerCase()) {
      case 'exit':
      case 'quit':
      case 'q':
        return false;

      case 'help':
      case '?':
        console.log(HELP);
        return true;

      case 'id':
        console.log(conversationId ?? out.dim('(no conversation yet — it is created with your first message)'));
        return true;

      case 'info': {
        if (!lastMeta) {
          console.log(out.dim('No reply yet.'));
          return true;
        }
        const m = lastMeta;
        const tps = tokPerSec(m);
        console.log(
          [
            `model        ${m.provider}/${m.model}`,
            `tokens       ${m.promptTokens} in / ${m.completionTokens} out (${m.usageSource === 'provider' ? 'reported by model' : 'estimated'})`,
            `latency      ttft ${m.ttftMs ?? '-'}ms, generation ${m.generationMs}ms, queued ${m.queueWaitMs}ms`,
            `speed        ${tps === null ? '-' : tps.toFixed(1) + ' tok/s'}`,
            `context      ${m.contextUsed} of ${m.contextBudget} tokens used, ${m.droppedMessages} message(s) dropped`,
          ].join('\n'),
        );
        return true;
      }

      case 'model': {
        const { data } = await client.models();
        if (!arg) {
          console.log(`next messages use: ${modelOverride ?? '(conversation default)'}`);
          console.log(data.map((m) => `  ${m.id}${m.default ? out.dim('  (server default)') : ''}`).join('\n'));
          return true;
        }
        if (!data.some((m) => m.id === arg)) {
          throw new CliError(`Unknown model "${arg}". Allowed: ${data.map((m) => m.id).join(', ')}`);
        }
        modelOverride = arg;
        console.log(out.dim(`Using ${arg} for your next messages.`));
        return true;
      }

      case 'title': {
        if (!arg) throw new CliError('Usage: /title <text>');
        if (conversationId) await client.renameConversation(conversationId, arg);
        else pendingTitle = arg;
        console.log(out.dim('Title set.'));
        return true;
      }

      case 'history': {
        if (!conversationId) {
          console.log(out.dim('No messages yet.'));
          return true;
        }
        const n = /^\d+$/.test(arg) ? Number(arg) : 10;
        const t = await client.getConversation(conversationId);
        const start = Math.max(0, t.messages.length - n);
        console.log(t.messages.slice(start).map((m, i) => formatMessage(m, start + i + 1, out)).join('\n'));
        return true;
      }

      case 'fork': {
        if (!conversationId) throw new CliError('Nothing to fork yet — send a message first.');
        const t = await client.getConversation(conversationId);
        const ref = resolveMessageRef(t.messages, arg || undefined);
        const forked = await client.forkConversation(conversationId, { fromMessageId: ref.message.id });
        conversationId = forked.id;
        console.log(out.dim(`Forked after message #${ref.index} → ${shortId(forked.id)} (${forked.messageCount} messages copied). You are on the new branch.`));
        console.log(out.dim(`Return to the original with: /switch ${shortId(t.id)}`));
        if (ref.message.role === 'user') {
          console.log(errc.yellow('Note: this branch ends on your own message, so your next prompt will follow it directly.'));
        }
        return true;
      }

      case 'switch': {
        if (!arg) throw new CliError('Usage: /switch <id|prefix|latest>');
        const id = await resolveConversationId(client, arg);
        const t = await client.getConversation(id);
        conversationId = id;
        const start = Math.max(0, t.messages.length - 2);
        console.log(out.dim(`Switched to ${shortId(id)} — ${t.title ?? '(untitled)'} [${t.defaultModel}]`));
        console.log(t.messages.slice(start).map((m, i) => formatMessage(m, start + i + 1, out)).join('\n'));
        return true;
      }

      default:
        console.log(out.dim(`Unknown command /${cmd}. Type /help.`));
        return true;
    }
  }

  rl.setPrompt(promptText());
  rl.prompt();
  for await (const raw of rl) {
    exitArmed = false;
    const line = raw.trim();
    try {
      if (!line) {
        /* ignore empty input */
      } else if (line.startsWith('/')) {
        if (!(await slash(line))) break;
      } else {
        await turn(line);
      }
    } catch (e) {
      console.error(errc.red(describeError(e)));
    }
    rl.setPrompt(promptText());
    rl.prompt();
  }
  rl.close();
}