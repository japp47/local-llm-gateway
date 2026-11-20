// Every shape the public API accepts or returns, in one place. Routes validate requests
// with these; `api/openapi.ts` turns them into the OpenAPI document; the contract tests
// check real responses against that document. Change a shape here and all three follow.
//
// Responses use strict objects (additionalProperties: false) so an undocumented field
// fails the contract test instead of leaking into the API silently.
import { z } from 'zod';

/** Named schemas become `#/components/schemas/<id>` in the OpenAPI document. */
export const components = z.registry<{ id: string; description?: string }>();
const named = <T extends z.ZodType>(schema: T, id: string, description?: string): T => {
  components.add(schema, { id, ...(description ? { description } : {}) });
  return schema;
};

const timestamp = z.iso.datetime().describe('ISO 8601 time, UTC');

// ---------- errors ----------

export const ErrorBody = named(
  z.strictObject({
    error: z.strictObject({
      code: z.string().describe('Stable machine-readable code, e.g. `ollama_unavailable`'),
      message: z.string().describe('Plain-language explanation'),
      hint: z.string().optional().describe('What to do about it, when known'),
      details: z.array(z.unknown()).optional().describe('Validation issues (code `invalid_request`)'),
      request_id: z.string(),
    }),
  }),
  'Error',
  'Every error response. `code` is for programs, `message` and `hint` are for people.',
);

// ---------- requests ----------
// Inlined in the document with zod's "input" view, so fields with defaults stay optional.

export const IdParams = z.object({ id: z.uuid() });

export const CreateConversationBody = z.object({
  title: z.string().min(1).max(200).optional(),
  model: z.string().optional().describe('Defaults to the gateway\'s default model'),
  systemPrompt: z.string().max(8_000).optional(),
});
export const RenameConversationBody = z.object({ title: z.string().min(1).max(200) });
export const ForkBody = z.object({
  fromMessageId: z.uuid().describe('Copy messages up to and including this one'),
  title: z.string().min(1).max(200).optional(),
  defaultModel: z.string().optional(),
});
export const ListConversationsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(200).optional().describe('`nextCursor` from the previous page'),
});
export const TranscriptQuery = z.object({
  after: z.coerce.number().int().min(0).default(0).describe('Continue after this message `seq`'),
  limit: z.coerce.number().int().min(1).max(500).default(500),
});
export const SendMessageBody = z.object({
  content: z.string().min(1).max(16_000),
  model: z.string().optional().describe('For this message only; defaults to the conversation\'s model'),
  temperature: z.number().min(0).max(2).optional(),
});
export const StatsQuery = z.object({
  hours: z.coerce.number().int().min(1).max(720).default(24),
  recent: z.coerce.number().int().min(0).max(50).default(5),
});
export const LegacyChatBody = z.object({
  model: z.string(),
  messages: z
    .array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string().max(32_000) }))
    .min(1),
  stream: z.boolean().optional().default(false),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().max(2048).optional(),
});

// ---------- responses ----------

export const Me = named(z.strictObject({ id: z.uuid(), email: z.string() }), 'Me');

export const ModelInfo = named(z.strictObject({ id: z.string(), default: z.boolean() }), 'ModelInfo');
export const ModelList = named(z.strictObject({ data: z.array(ModelInfo) }), 'ModelList');

export const Conversation = named(
  z.strictObject({
    id: z.uuid(),
    title: z.string().nullable(),
    defaultModel: z.string(),
    systemPrompt: z.string().nullable(),
    parentConversationId: z.uuid().nullable().describe('Set on forks'),
    forkedFromMessageId: z.uuid().nullable().describe('Set on forks'),
    createdAt: timestamp,
    updatedAt: timestamp,
  }),
  'Conversation',
);
export const ConversationPage = named(
  z.strictObject({
    data: z.array(Conversation),
    nextCursor: z.string().nullable().describe('Pass as `?cursor=` for the next page; null on the last page'),
  }),
  'ConversationPage',
);
export const Message = named(
  z.strictObject({
    id: z.uuid(),
    seq: z.number().int().describe('Ordering key; pass as `?after=` to page'),
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z.string(),
    status: z.enum(['complete', 'partial', 'error']).describe('`partial`: the answer was cut off'),
    model: z.string().nullable(),
    createdAt: timestamp,
  }),
  'Message',
);
export const ConversationWithMessages = named(
  z.strictObject({
    ...Conversation.shape,
    messages: z.array(Message),
    messageCount: z.number().int().describe('Total in the conversation, not just this page'),
    nextAfter: z.number().int().nullable().describe('Pass as `?after=` for the next page; null on the last page'),
  }),
  'ConversationWithMessages',
);
export const ForkedConversation = named(
  z.strictObject({ ...Conversation.shape, messageCount: z.number().int().describe('Messages copied into the fork') }),
  'ForkedConversation',
);

const ms = z.number().nullable();
export const ModelStats = named(
  z.strictObject({
    model: z.string(),
    provider: z.string(),
    requests: z.number().int(),
    complete: z.number().int(),
    partial: z.number().int(),
    errors: z.number().int(),
    promptTokens: z.number().int(),
    completionTokens: z.number().int(),
    avgTtftMs: ms,
    p50TtftMs: ms,
    p95TtftMs: ms,
    avgQueueMs: ms,
    avgTokPerSec: ms,
  }),
  'ModelStats',
);
export const RecentGeneration = named(
  z.strictObject({
    requestId: z.string(),
    conversationId: z.uuid().nullable(),
    provider: z.string(),
    model: z.string(),
    status: z.enum(['complete', 'partial', 'error']),
    errorCode: z.string().nullable(),
    promptTokens: z.number().int().nullable(),
    completionTokens: z.number().int().nullable(),
    queueWaitMs: ms,
    ttftMs: ms,
    generationMs: ms,
    createdAt: timestamp,
  }),
  'RecentGeneration',
);
export const Stats = named(
  z.strictObject({ hours: z.number().int(), since: timestamp, models: z.array(ModelStats), recent: z.array(RecentGeneration) }),
  'Stats',
);

export const Check = named(
  z.strictObject({
    id: z.string(),
    status: z.enum(['ok', 'warn', 'fail']),
    message: z.string(),
    hint: z.string().optional(),
  }),
  'Check',
);
export const DoctorReport = named(
  z.strictObject({ mode: z.enum(['single', 'server']), checks: z.array(Check) }),
  'DoctorReport',
);
export const BackupSummary = named(
  z.strictObject({
    file: z.string().describe('Where the backup was written, on the gateway\'s machine'),
    conversations: z.number().int(),
    messages: z.number().int(),
    bytes: z.number().int(),
    createdAt: timestamp,
  }),
  'BackupSummary',
);

export const Health = named(z.strictObject({ ok: z.literal(true), mode: z.enum(['single', 'server']) }), 'Health');
export const Readiness = named(z.strictObject({ ok: z.boolean(), ollama: z.boolean(), db: z.boolean() }), 'Readiness');
export const LegacyChatResponse = named(
  z.looseObject({}).describe('OpenAI-compatible chat completion, passed through from Ollama'),
  'LegacyChatResponse',
);

// ---------- streamed events (POST /v1/conversations/{id}/messages) ----------

export const StartEvent = named(
  z.strictObject({ requestId: z.string(), conversationId: z.uuid(), userMessageId: z.uuid(), model: z.string() }),
  'StartEvent',
  'First event: the user message is saved and generation is starting',
);
export const DeltaEvent = named(z.strictObject({ type: z.literal('delta'), text: z.string() }), 'DeltaEvent', 'A piece of the answer');
export const MetaEvent = named(
  z.strictObject({
    type: z.literal('meta'),
    provider: z.string(),
    model: z.string(),
    promptTokens: z.number().int(),
    completionTokens: z.number().int(),
    usageSource: z.enum(['provider', 'estimated']),
    queueWaitMs: z.number(),
    ttftMs: z.number().nullable(),
    generationMs: z.number(),
    totalMs: z.number(),
    contextUsed: z.number().int(),
    contextBudget: z.number().int(),
    droppedMessages: z.number().int().describe('Older messages left out to fit the context'),
  }),
  'MetaEvent',
  'Token counts and timings, sent after the answer',
);
export const DoneEvent = named(
  z.strictObject({
    type: z.literal('done'),
    assistantMessageId: z.uuid().nullable(),
    status: z.enum(['complete', 'partial', 'error']),
  }),
  'DoneEvent',
  'Last event',
);
export const ErrorEvent = named(
  z.strictObject({ type: z.literal('error'), code: z.string(), message: z.string(), hint: z.string().optional() }),
  'ErrorEvent',
  'The answer failed after it started; whatever arrived is saved as `partial`',
);
export const SSE_EVENTS = { start: StartEvent, delta: DeltaEvent, meta: MetaEvent, done: DoneEvent, error: ErrorEvent } as const;
