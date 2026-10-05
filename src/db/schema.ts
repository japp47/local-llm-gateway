import { bigserial, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  keyHash: text('key_hash').notNull().unique(), // SHA-256 of the raw key; raw key is shown once
  label: text('label'),
  createdAt: ts('created_at').notNull().defaultNow(),
  revokedAt: ts('revoked_at'),
});

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id),
    title: text('title'),
    defaultModel: text('default_model').notNull(),
    systemPrompt: text('system_prompt'),
    leaseUntil: ts('lease_until'), // one in-flight generation per conversation
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('conversations_user_updated_idx').on(t.userId, t.updatedAt)],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seq: bigserial('seq', { mode: 'number' }).notNull(), // strict ordering key
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // system | user | assistant | tool
    content: text('content').notNull(),
    status: text('status').notNull().default('complete'), // complete | partial | error
    model: text('model'), // the model that produced an assistant message
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('messages_conv_seq_idx').on(t.conversationId, t.seq)],
);

// One row per generation attempt: the operational dataset (latency, tokens, failures).
export const generations = pgTable(
  'generations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: text('request_id').notNull(),
    userId: uuid('user_id').notNull().references(() => users.id),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    messageId: uuid('message_id'),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    estPromptTokens: integer('est_prompt_tokens'), // our estimate, to calibrate the counter
    queueWaitMs: integer('queue_wait_ms'),
    ttftMs: integer('ttft_ms'),
    generationMs: integer('generation_ms'),
    totalMs: integer('total_ms'),
    status: text('status').notNull(), // complete | partial | error
    errorCode: text('error_code'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('generations_user_created_idx').on(t.userId, t.createdAt),
    index('generations_request_idx').on(t.requestId),
  ],
);