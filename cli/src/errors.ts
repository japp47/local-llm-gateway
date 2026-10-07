import { ApiError, ConnectionError } from './api.js';

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

export function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'invalid_api_key':
        return 'The gateway rejected your API key. Update the saved key with: llm config set apiKey  (you will be prompted)';
      case 'conversation_busy':
        return 'That conversation is still generating a reply. Wait for it to finish, then retry.';
      case 'server_busy':
        return `The gateway queue is full. Retry ${e.retryAfter ? `in ${e.retryAfter}s` : 'shortly'}.`;
      case 'rate_limited':
        return 'Rate limit reached. Wait a moment, then retry.';
      case 'context_too_large':
        return `That message does not fit the model's context window. ${e.message}`;
      case 'model_not_allowed':
        return `${e.message}. See the allowed models with: llm models`;
      case 'conversation_not_found':
        return 'Conversation not found (or it belongs to another key). See: llm ls';
      default:
        return `${e.message} [${e.code}${e.requestId ? ` ${e.requestId}` : ''}]`;
    }
  }
  if (e instanceof ConnectionError || e instanceof Error) return e.message;
  return String(e);
}