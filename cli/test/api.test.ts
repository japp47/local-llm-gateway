import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient, ApiError, ConnectionError } from '../src/api.js';
import { describeError } from '../src/errors.js';

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const META = {
  provider: 'fake', model: 'm', promptTokens: 5, completionTokens: 2, usageSource: 'provider', queueWaitMs: 0,
  ttftMs: 10, generationMs: 50, totalMs: 60, contextUsed: 20, contextBudget: 3000, droppedMessages: 0,
};

describe('ApiClient', () => {
  let server: Server;
  let base = '';
  let handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
  let lastAuth: string | undefined;

  beforeEach(async () => {
    handler = (_req, res) => void res.writeHead(404).end();
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      lastAuth = req.headers.authorization;
      void handler(req, res);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const client = () => new ApiClient({ baseUrl: base, apiKey: 'llmgw_test' });

  it('sends the bearer token and returns JSON', async () => {
    handler = (_req, res) => void res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[],"nextBefore":null}');
    expect(await client().listConversations(5)).toEqual({ data: [], nextBefore: null });
    expect(lastAuth).toBe('Bearer llmgw_test');
  });

  it('loads the allowed models and default from the gateway', async () => {
    handler = (_req, res) =>
      void res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[{"id":"llama3.2:3b","default":true}]}');
    expect(await client().models()).toEqual({ data: [{ id: 'llama3.2:3b', default: true }] });
    expect(lastAuth).toBe('Bearer llmgw_test');
  });

  it('loads the configured default model from the singular endpoint', async () => {
    handler = (_req, res) =>
      void res.writeHead(200, { 'content-type': 'application/json' }).end('{"id":"llama3.2:3b","default":true}');
    expect(await client().defaultModel()).toEqual({ id: 'llama3.2:3b', default: true });
    expect(lastAuth).toBe('Bearer llmgw_test');
  });

  it('streams a reply whose frames are split mid-event', async () => {
    handler = async (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const all =
        frame('start', { requestId: 'r', conversationId: 'c', userMessageId: 'u', model: 'm' }) +
        frame('delta', { text: 'Hel' }) + frame('delta', { text: 'lo' }) +
        frame('meta', META) + frame('done', { assistantMessageId: 'a1', status: 'complete' });
      for (let i = 0; i < all.length; i += 11) {
        res.write(all.slice(i, i + 11));
        await new Promise((r) => setTimeout(r, 2));
      }
      res.end();
    };
    const seen: string[] = [];
    const r = await client().streamMessage('c', { content: 'hi' }, { onDelta: (t) => seen.push(t) });
    expect(seen).toEqual(['Hel', 'lo']);
    expect(r).toMatchObject({ text: 'Hello', status: 'complete', aborted: false, incomplete: false, assistantMessageId: 'a1' });
    expect(r.meta?.completionTokens).toBe(2);
  });

  it('flags a stream that ends without a done event', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(frame('delta', { text: 'cut off' }));
    };
    const r = await client().streamMessage('c', { content: 'hi' });
    expect(r).toMatchObject({ text: 'cut off', incomplete: true });
  });

  it('reports a server-side generation error event', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(frame('delta', { text: 'a' }) + frame('error', { code: 'provider_error', message: 'x' }) +
        frame('done', { assistantMessageId: 'p', status: 'partial' }));
    };
    const r = await client().streamMessage('c', { content: 'hi' });
    expect(r.error?.code).toBe('provider_error');
    expect(r.status).toBe('partial');
  });

  it('turns an abort mid-stream into a partial result, not an exception', async () => {
    handler = async (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (let i = 0; i < 100 && !res.destroyed; i++) {
        res.write(frame('delta', { text: `t${i} ` }));
        await new Promise((r) => setTimeout(r, 20));
      }
      res.end();
    };
    const ac = new AbortController();
    const r = await client().streamMessage('c', { content: 'hi' }, { onDelta: (t) => t === 't2 ' && ac.abort() }, ac.signal);
    expect(r).toMatchObject({ aborted: true, status: 'partial', incomplete: false });
    expect(r.text.startsWith('t0 t1 t2')).toBe(true);
  });

  it('maps gateway errors to ApiError with friendly text', async () => {
    handler = (_req, res) => {
      res.writeHead(409, { 'content-type': 'application/json', 'retry-after': '5' })
        .end('{"error":{"code":"conversation_busy","message":"busy","request_id":"req_1"}}');
    };
    const err = await client().streamMessage('c', { content: 'hi' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'conversation_busy', requestId: 'req_1' });
    expect(describeError(err)).toMatch(/still generating/);
  });

  it('raises a ConnectionError with a hint when the gateway is down', async () => {
    const dead = new ApiClient({ baseUrl: 'http://127.0.0.1:1', apiKey: 'k' });
    const err = await dead.models().catch((e) => e);
    expect(err).toBeInstanceOf(ConnectionError);
    expect(describeError(err)).toMatch(/Cannot reach the gateway/);
  });
});