// SQLite schema for single-user mode. It mirrors storage/postgres/schema.ts table by table;
// the shared integration suite checks that both behave the same.
// Differences: ids are text UUIDs made in app code, timestamps are integer milliseconds,
// and messages.seq is the AUTOINCREMENT primary key (strictly increasing, never reused).
import { randomUUID } from 'node:crypto';
import {
  index,
  integer,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

const id = () => text('id').primaryKey().$defaultFn(() => randomUUID());
const ms = (name: string) => integer(name, { mode: 'timestamp_ms' });
const createdAt = () => ms('created_at').notNull().$defaultFn(() => new Date());

export const users = sqliteTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  createdAt: createdAt(),
});

export const apiKeys = sqliteTable('api_keys', {
  id: id(),
  userId: text('user_id').notNull().references(() => users.id),
  keyHash: text('key_hash').notNull().unique(), // SHA-256 of the raw key; raw key is shown once
  label: text('label'),
  createdAt: createdAt(),
  revokedAt: ms('revoked_at'),
});

export const conversations = sqliteTable(
  'conversations',
  {
    id: id(),
    userId: text('user_id').notNull().references(() => users.id),
    title: text('title'),
    defaultModel: text('default_model').notNull(),
    systemPrompt: text('system_prompt'),
    parentConversationId: text('parent_conversation_id').references(
      (): AnySQLiteColumn => conversations.id,
      { onDelete: 'set null' },
    ),
    forkedFromMessageId: text('forked_from_message_id').references(
      (): AnySQLiteColumn => messages.id,
      { onDelete: 'set null' },
    ),
    leaseUntil: ms('lease_until'), // one in-flight generation per conversation
    createdAt: createdAt(),
    updatedAt: ms('updated_at').notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    index('conversations_user_updated_idx').on(t.userId, t.updatedAt),
    index('conversations_parent_idx').on(t.parentConversationId),
  ],
);

export const messages = sqliteTable(
  'messages',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }), // strict ordering key
    id: text('id').notNull().unique().$defaultFn(() => randomUUID()),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // system | user | assistant | tool
    content: text('content').notNull(),
    status: text('status').notNull().default('complete'), // complete | partial | error
    model: text('model'), // the model that produced an assistant message
    createdAt: createdAt(),
  },
  (t) => [index('messages_conv_seq_idx').on(t.conversationId, t.seq)],
);

// One row per generation attempt: the operational dataset (latency, tokens, failures).
export const generations = sqliteTable(
  'generations',
  {
    id: id(),
    requestId: text('request_id').notNull(),
    userId: text('user_id').notNull().references(() => users.id),
    conversationId: text('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    messageId: text('message_id'),
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
    createdAt: createdAt(),
  },
  (t) => [
    index('generations_user_created_idx').on(t.userId, t.createdAt),
    index('generations_request_idx').on(t.requestId),
  ],
);
