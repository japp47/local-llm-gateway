export interface Conversation {
  id: string;
  title: string | null;
  defaultModel: string;
  systemPrompt: string | null;
  parentConversationId: string | null;
  forkedFromMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  status: 'complete' | 'partial' | 'error';
  model: string | null;
  createdAt: string;
}

export interface Transcript extends Conversation {
  messages: Message[];
}

export interface ConversationPage {
  data: Conversation[];
  nextBefore: string | null;
}

export interface CreateConversationInput {
  title?: string;
  model?: string;
  systemPrompt?: string;
}

export interface ForkConversationInput {
  fromMessageId: string;
  title?: string;
  defaultModel?: string;
}

export interface SendMessageInput {
  content: string;
  model?: string;
  temperature?: number;
}

export interface StreamMeta {
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

export interface ModelInfo {
  id: string;
  default: boolean;
}

export interface ModelStats {
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

export interface RecentGeneration {
  requestId: string;
  conversationId: string | null;
  provider: string;
  model: string;
  status: string;
  errorCode: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  queueWaitMs: number | null;
  ttftMs: number | null;
  generationMs: number | null;
  createdAt: string;
}

export interface Stats {
  hours: number;
  since: string;
  models: ModelStats[];
  recent: RecentGeneration[];
}

export interface ModelList {
  data: ModelInfo[];
}

export interface ForkedConversation extends Conversation {
  messageCount: number;
}

export interface StreamStartInfo {
  requestId: string;
  conversationId: string;
  userMessageId: string;
  model: string;
}

export interface StreamHandlers {
  onStart?: (info: StreamStartInfo) => void;
  onDelta?: (text: string) => void;
}

export interface StreamError {
  code: string;
  message: string;
}

export interface StreamResult {
  text: string;
  status: 'complete' | 'partial' | 'error';
  aborted: boolean;
  incomplete: boolean;
  meta?: StreamMeta;
  error?: StreamError;
  userMessageId?: string;
  assistantMessageId?: string | null;
}

export interface ApiClientConfig {
  baseUrl: string;
  apiKey: string;
}

export interface CurrentUser {
  id: string;
  email: string;
}