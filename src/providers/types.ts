export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export type ChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'usage'; promptTokens: number; completionTokens: number }
  | { type: 'done'; finishReason: string | null };

export interface LLMProvider {
  readonly name: string;
  chat(req: ChatRequest): AsyncIterable<ChatEvent>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly upstreamStatus?: number,
    readonly detail?: string,
  ) {
    super(message);
  }
}