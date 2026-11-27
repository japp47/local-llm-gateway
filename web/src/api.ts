// Talks to the gateway that served this page. Signed in by the session cookie, which the
// browser sends by itself (same origin); the page never sees a key or the cookie's value.
import { SseParser } from './sse';
import type {
  BackupSummary,
  DeviceList,
  PhoneInfo,
  Conversation,
  ConversationPage,
  ConversationWithMessages,
  ForkedConversation,
  Me,
  MetaEvent,
  ModelInfo,
  ModelList,
} from './types';

/** A problem to show the person: the gateway's own plain message and hint. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

const unreachable = () =>
  new ApiError(0, 'unreachable', "The assistant isn't running.", 'Start it with: llm start, then reload this page.');

async function toError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string; hint?: string } };
    if (body.error?.message) return new ApiError(res.status, body.error.code ?? `http_${res.status}`, body.error.message, body.error.hint);
  } catch {
    // not our JSON error shape
  }
  return new ApiError(res.status, `http_${res.status}`, `Something went wrong (error ${res.status}).`);
}

async function call(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw unreachable();
  }
  if (!res.ok) throw await toError(res);
  return res;
}

const json = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const res = await call(method, path, body);
  return (res.status === 204 ? undefined : await res.json()) as T;
};

export interface StreamHandlers {
  onDelta(text: string): void;
  onMeta?(meta: MetaEvent): void;
  /** The answer broke after it started; what arrived is saved as `partial`. */
  onError?(err: ApiError): void;
}

export const api = {
  signIn: (code: string) => json<void>('POST', '/web/session', { code }),
  signOut: () => json<void>('DELETE', '/web/session'),
  me: () => json<Me>('GET', '/v1/me'),
  defaultModel: () => json<ModelInfo>('GET', '/v1/model'),
  models: () => json<ModelList>('GET', '/v1/models'),
  conversations: (cursor?: string) =>
    json<ConversationPage>('GET', `/v1/conversations?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  conversation: (id: string) => json<ConversationWithMessages>('GET', `/v1/conversations/${id}?limit=500`),
  create: (body: { title?: string; model?: string } = {}) => json<Conversation>('POST', '/v1/conversations', body),
  rename: (id: string, title: string) => json<Conversation>('PATCH', `/v1/conversations/${id}`, { title }),
  remove: (id: string) => json<void>('DELETE', `/v1/conversations/${id}`),
  fork: (id: string, fromMessageId: string) =>
    json<ForkedConversation>('POST', `/v1/conversations/${id}/forks`, { fromMessageId }),
  backup: () => json<BackupSummary>('POST', '/v1/backup'),
  phoneInfo: () => json<PhoneInfo>('GET', '/v1/web/phone'),
  pairCode: () => json<{ code: string; expiresAt: string }>('POST', '/v1/web/codes', { purpose: 'pair' }),
  devices: () => json<DeviceList>('GET', '/v1/web/sessions'),
  removeDevice: (id: string) => json<void>('DELETE', `/v1/web/sessions/${id}`),

  /**
   * Sends a message and streams the answer. Problems before the answer starts (Ollama not
   * running, model missing, busy) throw an ApiError and nothing is saved. Aborting `signal`
   * stops the answer; the gateway keeps what arrived as `partial`.
   */
  async send(id: string, content: string, opts: { model?: string; signal: AbortSignal }, on: StreamHandlers): Promise<void> {
    const res = await call('POST', `/v1/conversations/${id}/messages`, { content, ...(opts.model ? { model: opts.model } : {}) }, opts.signal);
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    const parser = new SseParser();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const e of parser.push(value)) {
        if (e.event === 'delta') on.onDelta(String(e.data.text ?? ''));
        else if (e.event === 'meta') on.onMeta?.(e.data as unknown as MetaEvent);
        else if (e.event === 'error') {
          on.onError?.(new ApiError(200, String(e.data.code), String(e.data.message), e.data.hint as string | undefined));
        }
      }
    }
  },
};
