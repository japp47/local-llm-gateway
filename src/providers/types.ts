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
  /**
   * Resolves once the provider has accepted the request (reachable, model found and loaded),
   * before any text arrives. Rejects with a ProviderError otherwise. Callers save nothing
   * until this resolves, so a refused request leaves no trace and can simply be retried.
   */
  chat(req: ChatRequest): Promise<AsyncIterable<ChatEvent>>;
}

/** Stable codes for programs. The message and hint are for people. */
export type ProviderErrorCode =
  | 'ollama_unavailable' // not running or unreachable
  | 'model_not_installed' // the model was never downloaded
  | 'model_too_large' // the engine refused to load it: not enough memory
  | 'model_stopped' // the connection dropped mid-answer
  | 'provider_error'; // anything else; details go to the log only

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly hint?: string,
    /** For logs only: never shown to users (may contain internal paths or versions). */
    readonly detail?: string,
  ) {
    super(message);
  }
}
