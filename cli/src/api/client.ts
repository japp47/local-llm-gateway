import { ApiError, ConnectionError, toApiError } from './errors.js';
import { consumeStream } from './stream.js';
import type {
  ApiClientConfig,
  Conversation,
  ConversationPage,
  CreateConversationInput,
  ForkedConversation,
  ForkConversationInput,
  ModelList,
  ModelInfo,
  SendMessageInput,
  Stats,
  StreamHandlers,
  StreamResult,
  Transcript,
  CurrentUser,
} from './types.js';

interface RequestOptions {
  body?: unknown;
  signal?: AbortSignal;
  accept?: string;
}

function isAbort(error: unknown): boolean {
  return typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError';
}

export class ApiClient {
  constructor(
    private readonly cfg: ApiClientConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request(
    method: string,
    path: string,
    opts: RequestOptions = {},
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.cfg.baseUrl + path, {
        method,
        headers: {
          authorization: `Bearer ${this.cfg.apiKey}`,
          accept: opts.accept ?? 'application/json',
          ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal,
      });
    } catch (error) {
      if (isAbort(error)) throw error;
      throw new ConnectionError(
        `Cannot reach the gateway at ${this.cfg.baseUrl}. Is it running? (npm run dev)`,
      );
    }
    if (!response.ok) throw await toApiError(response);
    return response;
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.request(method, path, { body });
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  listConversations(limit = 20, before?: string) {
    const query = new URLSearchParams({ limit: String(limit) });
    if (before) query.set('before', before);
    return this.json<ConversationPage>('GET', `/v1/conversations?${query}`);
  }

  getConversation(id: string) {
    return this.json<Transcript>('GET', `/v1/conversations/${encodeURIComponent(id)}`);
  }

  createConversation(body: CreateConversationInput) {
    return this.json<Conversation>('POST', '/v1/conversations', body);
  }

  renameConversation(id: string, title: string) {
    return this.json<Conversation>('PATCH', `/v1/conversations/${encodeURIComponent(id)}`, { title });
  }

  deleteConversation(id: string) {
    return this.json<void>('DELETE', `/v1/conversations/${encodeURIComponent(id)}`);
  }

  forkConversation(id: string, body: ForkConversationInput) {
    return this.json<ForkedConversation>(
      'POST',
      `/v1/conversations/${encodeURIComponent(id)}/forks`,
      body,
    );
  }

  me() {
    return this.json<CurrentUser>('GET', '/v1/me');
  }
  
  models() {
    return this.json<ModelList>('GET', '/v1/models');
  }

  defaultModel() {
    return this.json<ModelInfo>('GET', '/v1/model');
  }

  stats(hours = 24, recent = 5) {
    const query = new URLSearchParams({ hours: String(hours), recent: String(recent) });
    return this.json<Stats>('GET', `/v1/stats?${query}`);
  }

  /** Sends a message and consumes the SSE reply. Pre-stream failures throw ApiError. */
  async streamMessage(
    id: string,
    body: SendMessageInput,
    handlers: StreamHandlers = {},
    signal?: AbortSignal,
  ): Promise<StreamResult> {
    try {
      const response = await this.request(
        'POST',
        `/v1/conversations/${encodeURIComponent(id)}/messages`,
        { body, signal, accept: 'text/event-stream' },
      );
      return await consumeStream(response, handlers, signal);
    } catch (error) {
      if (isAbort(error) || signal?.aborted) {
        return { text: '', status: 'partial', aborted: true, incomplete: false };
      }
      throw error;
    }
  }
}
