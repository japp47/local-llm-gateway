import type { config } from '../config.js';
import { AppError } from '../lib/errors.js';
import { QueueFullError, type Semaphore } from '../lib/semaphore.js';
import type { TokenCounter } from '../lib/tokens.js';
import type { Metrics } from '../plugins/metrics.js';
import { ProviderError, type ChatMessage, type LLMProvider } from '../providers/types.js';
import type { ConversationsRepo } from '../repositories/conversations.js';
import type { GenerationsRepo } from '../repositories/generations.js';
import type { MessagesRepo } from '../repositories/messages.js';
import { buildContext, ContextTooLargeError } from './context-builder.js';

export interface StartInfo {
  requestId: string;
  conversationId: string;
  userMessageId: string;
  model: string;
}

export type ServerEvent =
  | { type: 'delta'; text: string }
  | { type: 'error'; code: string; message: string }
  | {
      type: 'meta';
      provider: string;
      model: string;
      promptTokens: number;
      completionTokens: number;
      usageSource: 'provider' | 'estimated';
      queueWaitMs: number;
      ttftMs: number | null;
      generationMs: number;
      totalMs: number;
      contextUsed: number;
      contextBudget: number;
      droppedMessages: number;
    }
  | { type: 'done'; assistantMessageId: string | null; status: 'complete' | 'partial' | 'error' };

export interface Sink {
  /** Called once, right before the first byte is sent. Failures before this point become HTTP errors. */
  begin(info: StartInfo): Promise<void>;
  event(e: ServerEvent): Promise<void>;
}

export interface SendParams {
  userId: string;
  conversationId: string;
  content: string;
  model?: string;
  temperature?: number;
  requestId: string;
  signal: AbortSignal;
  log: { warn(obj: object, msg: string): void };
}

export interface ConversationServiceDeps {
  config: config;
  provider: LLMProvider;
  limiter: Semaphore;
  metrics: Metrics;
  counter: TokenCounter;
  conversations: ConversationsRepo;
  messages: MessagesRepo;
  generations: GenerationsRepo;
}

export class ConversationService {
  constructor(private readonly d: ConversationServiceDeps) {}

  async sendMessage(p: SendParams, sink: Sink): Promise<void> {
    const { config } = this.d;
    const requestStart = performance.now();

    const conv = await this.d.conversations.get(p.userId, p.conversationId);
    if (!conv) throw new AppError(404, 'conversation_not_found', 'conversation not found');

    const model = p.model ?? conv.defaultModel;
    if (!config.allowedModels.has(model)) {
      throw new AppError(400, 'model_not_allowed', `model not allowed: ${model}`);
    }

    // One in-flight generation per conversation (lease survives crashes by expiring).
    if (!(await this.d.conversations.acquireLease(conv.id, config.LEASE_SECONDS))) {
      throw new AppError(409, 'conversation_busy', 'a generation is already running here');
    }

    let releaseSlot: (() => void) | undefined;
    try {
      const history = await this.d.messages.listRecent(conv.id, config.MAX_HISTORY_MESSAGES);
      const historyMessages: ChatMessage[] = history
        .filter((m) => m.status !== 'error' && (m.role === 'user' || m.role === 'assistant'))
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      let ctx;
      try {
        ctx = buildContext({
          systemPrompt: conv.systemPrompt,
          history: historyMessages,
          userMessage: { role: 'user', content: p.content },
          maxContextTokens: config.MODEL_CONTEXT_TOKENS,
          reserveOutputTokens: config.RESERVE_OUTPUT_TOKENS,
          counter: this.d.counter,
        });
      } catch (err) {
        if (err instanceof ContextTooLargeError) {
          throw new AppError(413, 'context_too_large', err.message);
        }
        throw err;
      }

      // Admission control. Rejecting here (before persisting anything) keeps retries clean.
      const queueStart = performance.now();
      releaseSlot = await this.acquireSlot(p.signal);
      const queueWaitMs = Math.round(performance.now() - queueStart);

      const userMsg = await this.d.messages.add({
        conversationId: conv.id,
        role: 'user',
        content: p.content,
      });
      await sink.begin({
        requestId: p.requestId,
        conversationId: conv.id,
        userMessageId: userMsg.id,
        model,
      });

      // ---- generation ----
      const started = performance.now();
      let text = '';
      let ttftMs: number | null = null;
      let usage: { promptTokens: number; completionTokens: number } | undefined;
      let status: 'complete' | 'partial' | 'error' = 'complete';
      let errorCode: string | null = null;

      try {
        for await (const ev of this.d.provider.chat({
          model,
          messages: ctx.messages,
          temperature: p.temperature,
          signal: p.signal,
        })) {
          if (ev.type === 'delta') {
            if (ttftMs === null) {
              ttftMs = Math.round(performance.now() - started);
              this.d.metrics.ttft.observe({ model }, ttftMs / 1000);
            }
            text += ev.text;
            await sink.event({ type: 'delta', text: ev.text });
          } else if (ev.type === 'usage') {
            usage = { promptTokens: ev.promptTokens, completionTokens: ev.completionTokens };
          }
        }
      } catch (err) {
        errorCode = p.signal.aborted
          ? 'aborted'
          : err instanceof ProviderError
            ? 'provider_error'
            : 'internal_error';
        status = text ? 'partial' : 'error';
        p.log.warn({ err: (err as Error).message, errorCode }, 'generation failed');
        if (errorCode !== 'aborted') {
          await sink.event({ type: 'error', code: errorCode, message: 'generation failed' });
        }
      }

      const generationMs = Math.round(performance.now() - started);
      releaseSlot(); // the slot guards the GPU, not the database
      releaseSlot = undefined;

      // ---- persistence ----
      const assistantMsg = text
        ? await this.d.messages.add({
            conversationId: conv.id,
            role: 'assistant',
            content: text,
            status,
            model,
          })
        : null;

      const usageSource = usage ? 'provider' : 'estimated';
      const promptTokens = usage?.promptTokens ?? ctx.promptTokensEstimate;
      const completionTokens = usage?.completionTokens ?? this.d.counter.count(text);
      const totalMs = Math.round(performance.now() - requestStart);

      await this.d.generations.add({
        requestId: p.requestId,
        userId: p.userId,
        conversationId: conv.id,
        messageId: assistantMsg?.id ?? null,
        provider: this.d.provider.name,
        model,
        promptTokens,
        completionTokens,
        estPromptTokens: ctx.promptTokensEstimate,
        queueWaitMs,
        ttftMs,
        generationMs,
        totalMs,
        status,
        errorCode,
      });
      await this.d.conversations.touch(
        conv.id,
        p.content.replace(/\s+/g, ' ').trim().slice(0, 60),
      );

      this.d.metrics.duration.observe({ model, status }, generationMs / 1000);
      this.d.metrics.tokens.inc({ model, kind: 'prompt' }, promptTokens);
      this.d.metrics.tokens.inc({ model, kind: 'completion' }, completionTokens);

      await sink.event({
        type: 'meta',
        provider: this.d.provider.name,
        model,
        promptTokens,
        completionTokens,
        usageSource,
        queueWaitMs,
        ttftMs,
        generationMs,
        totalMs,
        contextUsed: ctx.promptTokensEstimate,
        contextBudget: ctx.budget,
        droppedMessages: ctx.droppedMessages,
      });
      await sink.event({ type: 'done', assistantMessageId: assistantMsg?.id ?? null, status });
    } finally {
      releaseSlot?.();
      await this.d.conversations.releaseLease(conv.id).catch(() => {});
    }
  }

  private async acquireSlot(signal: AbortSignal): Promise<() => void> {
    try {
      return await this.d.limiter.acquire(signal);
    } catch (err) {
      if (err instanceof QueueFullError) {
        this.d.metrics.rejected.inc({ reason: 'queue_full' });
        throw new AppError(503, 'server_busy', 'server busy, retry later', { 'retry-after': '5' });
      }
      throw new AppError(504, 'cancelled', 'request cancelled or timed out while queued');
    }
  }
}