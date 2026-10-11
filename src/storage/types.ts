// Domain types shared by every storage adapter. They are plain TS types, not ORM
// row types, so the Postgres schema does not define the contract for other backends.

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';
export type MessageStatus = 'complete' | 'partial' | 'error';

export interface User {
  id: string;
  email: string;
  createdAt: Date;
}

export interface ApiKey {
  id: string;
  userId: string;
  keyHash: string;
  label: string | null;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface Conversation {
  id: string;
  userId: string;
  title: string | null;
  defaultModel: string;
  systemPrompt: string | null;
  parentConversationId: string | null;
  forkedFromMessageId: string | null;
  leaseUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewConversation {
  userId: string;
  defaultModel: string;
  title?: string;
  systemPrompt?: string;
}

export interface ForkInput {
  userId: string;
  sourceConversationId: string;
  fromMessageId: string;
  title?: string;
  defaultModel?: string;
}

export type ForkResult =
  | { kind: 'conversation_not_found' }
  | { kind: 'message_not_found' }
  | { kind: 'forked'; conversation: Conversation; messageCount: number };

export interface Message {
  id: string;
  seq: number; // strict ordering key, increasing across the whole table
  conversationId: string;
  role: string; // a MessageRole, stored as text
  content: string;
  status: string; // a MessageStatus, stored as text
  model: string | null;
  createdAt: Date;
}

export interface NewMessage {
  conversationId: string;
  role: MessageRole;
  content: string;
  status?: MessageStatus;
  model?: string | null;
}

/** One row per generation attempt: latency, tokens and outcome. */
export interface Generation {
  id: string;
  requestId: string;
  userId: string;
  conversationId: string | null;
  messageId: string | null;
  provider: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  estPromptTokens: number | null;
  queueWaitMs: number | null;
  ttftMs: number | null;
  generationMs: number | null;
  totalMs: number | null;
  status: string; // complete | partial | error
  errorCode: string | null;
  createdAt: Date;
}

export type NewGeneration = Omit<Generation, 'id' | 'createdAt'>;

export type RecentGeneration = Pick<
  Generation,
  | 'requestId'
  | 'conversationId'
  | 'provider'
  | 'model'
  | 'status'
  | 'errorCode'
  | 'promptTokens'
  | 'completionTokens'
  | 'queueWaitMs'
  | 'ttftMs'
  | 'generationMs'
  | 'createdAt'
>;

export interface ModelStatsRow {
  model: string;
  provider: string;
  requests: number;
  complete: number;
  partial: number;
  errors: number;
  promptTokens: number;
  completionTokens: number;
  avgTtftMs: number | null;
  p50TtftMs: number | null;
  p95TtftMs: number | null;
  avgQueueMs: number | null;
  avgTokPerSec: number | null;
}
