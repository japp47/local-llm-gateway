import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OllamaProvider } from '../src/providers/ollama.js';
import { makeTestApp, parseSse, waitFor } from './helpers.js';

type T = Awaited<ReturnType<typeof makeTestApp>>;

const sseData = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
const delta = (content: string) => sseData({ choices: [{ delta: { content }, finish_reason: null }] });
const finish = sseData({ choices: [{ delta: {}, finish_reason: 'stop' }] });
const usage = (p: number, c: number) => sseData({ choices: [], usage: { prompt_tokens: p, completion_tokens: c } });

/** A stand-in for Ollama's OpenAI-compatible endpoint. */
class FakeOllama {
  server!: Server;
  url = '';
  mode: 'normal' | 'split' | 'error' | 'slow' | 'missing' | 'oom' | 'drop' = 'normal';
  requests: unknown[] = [];
  upstreamClosed = false;

  async start() {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }
  stop() {
    this.server.closeAllConnections();
    return new Promise<void>((r) => this.server.close(() => r()));
  }

  private async handle(req: IncomingMessage, res: import('node:http').ServerResponse) {
    let raw = '';
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    this.requests.push(body);
    res.on('close', () => { if (!res.writableEnded) this.upstreamClosed = true; });

    if (this.mode === 'error') {
      res.writeHead(500, { 'content-type': 'application/json' }).end('{"error":"model crashed"}');
      return;
    }
    if (this.mode === 'missing') {
      // Ollama 0.35's exact answer for a model that was never pulled
      res.writeHead(404, { 'content-type': 'application/json' }).end(
        `{"error":{"message":"model '${body.model}' not found","type":"not_found_error","param":null,"code":null}}`,
      );
      return;
    }
    if (this.mode === 'oom') {
      // Ollama refuses to load before trying, when its memory check fails
      res.writeHead(500, { 'content-type': 'application/json' }).end(
        '{"error":{"message":"model requires more system memory (17.5 GiB) than is available (9.8 GiB)","type":"api_error","param":null,"code":null}}',
      );
      return;
    }
    if (!body.stream) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Hi there' } }], usage: { prompt_tokens: 7, completion_tokens: 3 } }),
      );
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (this.mode === 'drop') {
      // the model process dies mid-answer: the connection breaks without a clean end
      res.write(delta('Half an'));
      await new Promise((r) => setTimeout(r, 20));
      res.destroy();
      return;
    }
    if (this.mode === 'slow') {
      for (let i = 0; i < 100 && !res.destroyed; i++) {
        res.write(delta(`tok${i} `));
        await new Promise((r) => setTimeout(r, 40));
      }
      res.end();
      return;
    }
    if (this.mode === 'split') {
      // one logical SSE stream, deliberately cut at awkward byte boundaries
      const whole = delta('Hi') + delta(' there') + finish + usage(11, 5) + 'data: [DONE]\n\n';
      for (let i = 0; i < whole.length; i += 7) {
        res.write(whole.slice(i, i + 7));
        await new Promise((r) => setTimeout(r, 2));
      }
      res.end();
      return;
    }
    res.write(delta('Hi') + delta(' there') + finish + usage(11, 5) + 'data: [DONE]\n\n');
    res.end();
  }
}

describe('against a fake Ollama upstream', () => {
  let t: T;
  let ollama: FakeOllama;

  beforeEach(async () => {
    ollama = new FakeOllama();
    await ollama.start();
    t = await makeTestApp(new OllamaProvider(ollama.url), { OLLAMA_URL: ollama.url });
  });
  afterEach(async () => {
    await t.close();
    await ollama.stop();
  });

  const sendMsg = async (headers: Record<string, string>, id: string, content = 'hello') =>
    t.app.inject({ method: 'POST', url: `/v1/conversations/${id}/messages`, headers, payload: { content } });
  const newConv = async (headers: Record<string, string>) =>
    (await t.app.inject({ method: 'POST', url: '/v1/conversations', headers, payload: {} })).json() as { id: string };

  it('streams through OllamaProvider and records provider-reported usage', async () => {
    const a = await t.addUser('a@example.com');
    const conv = await newConv(a.headers);
    const res = await sendMsg(a.headers, conv.id);

    const events = parseSse(res.payload);
    expect(events.filter((e) => e.event === 'delta').map((e) => e.data.text).join('')).toBe('Hi there');
    expect(events.find((e) => e.event === 'meta')!.data).toMatchObject({ promptTokens: 11, completionTokens: 5, usageSource: 'provider' });
    expect(ollama.requests[0]).toMatchObject({ model: 'fake-model', stream: true });
  });

  it('survives SSE frames split across network chunks', async () => {
    ollama.mode = 'split';
    const a = await t.addUser('a@example.com');
    const conv = await newConv(a.headers);
    const res = await sendMsg(a.headers, conv.id);
    const events = parseSse(res.payload);
    expect(events.filter((e) => e.event === 'delta').map((e) => e.data.text).join('')).toBe('Hi there');
    expect(events.find((e) => e.event === 'meta')!.data.promptTokens).toBe(11);
  });

  /** A refusal before streaming is a plain HTTP error, and nothing is saved, so a retry is clean. */
  async function expectCleanRefusal(status: number, code: string, hint?: string) {
    const a = await t.addUser('a@example.com');
    const conv = await newConv(a.headers);
    const res = await sendMsg(a.headers, conv.id);

    expect(res.statusCode).toBe(status);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json().error).toMatchObject({ code, ...(hint ? { hint } : {}) });
    expect((await t.deps.repos.messages.listPage(conv.id)).rows).toEqual([]);
    expect(await t.deps.repos.generations.listByUser(a.userId)).toEqual([]);
    expect(t.deps.limiter.inFlight).toBe(0);
    return { a, conv, res };
  }

  it('reports an upstream failure before streaming as an HTTP error, saving nothing', async () => {
    ollama.mode = 'error';
    const { res } = await expectCleanRefusal(502, 'provider_error');
    expect(res.json().error.message).not.toContain('model crashed'); // details stay in the log
  });

  it('explains a model that was never downloaded, with the pull command', async () => {
    ollama.mode = 'missing';
    await expectCleanRefusal(400, 'model_not_installed', 'Run: ollama pull fake-model');
  });

  it("explains that a model doesn't fit in memory", async () => {
    ollama.mode = 'oom';
    await expectCleanRefusal(503, 'model_too_large');
  });

  it('says Ollama is not running when nothing listens on its port', async () => {
    await ollama.stop();
    const { a, conv } = await expectCleanRefusal(503, 'ollama_unavailable');
    // the lease was released: a retry gets the same clean answer, not "conversation busy"
    expect((await sendMsg(a.headers, conv.id)).json().error.code).toBe('ollama_unavailable');
  });

  it('saves the partial answer and says the model stopped when the stream breaks', async () => {
    ollama.mode = 'drop';
    const a = await t.addUser('a@example.com');
    const conv = await newConv(a.headers);
    const res = await sendMsg(a.headers, conv.id);

    expect(res.statusCode).toBe(200);
    const events = parseSse(res.payload);
    expect(events.find((e) => e.event === 'error')!.data).toMatchObject({
      code: 'model_stopped',
      message: 'The model stopped unexpectedly.',
    });
    expect(events.at(-1)!.data).toMatchObject({ type: 'done', status: 'partial' });
    const msgs = (await t.deps.repos.messages.listPage(conv.id)).rows;
    expect(msgs.map((m) => [m.role, m.status])).toEqual([['user', 'complete'], ['assistant', 'partial']]);
    const rows = await t.deps.repos.generations.listByUser(a.userId);
    expect(rows[0]).toMatchObject({ status: 'partial', errorCode: 'model_stopped' });
  });

  it('legacy /v1/chat/completions still works (stream and non-stream)', async () => {
    const a = await t.addUser('a@example.com');
    const body = { model: 'fake-model', messages: [{ role: 'user', content: 'hi' }] };

    const plain = await t.app.inject({ method: 'POST', url: '/v1/chat/completions', headers: a.headers, payload: body });
    expect(plain.statusCode).toBe(200);
    expect(plain.json().choices[0].message.content).toBe('Hi there');

    const streamed = await t.app.inject({ method: 'POST', url: '/v1/chat/completions', headers: a.headers, payload: { ...body, stream: true } });
    expect(streamed.statusCode).toBe(200);
    expect(streamed.headers['x-request-id']).toMatch(/^req_/);
    expect(streamed.payload).toContain('data: [DONE]');
  });

  it('cancels upstream generation and releases slot and lease when the client disconnects', async () => {
    ollama.mode = 'slow';
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (t.app.server.address() as AddressInfo).port;
    const a = await t.addUser('a@example.com');
    const conv = await newConv(a.headers);

    const ac = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/v1/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { ...a.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'go' }),
      signal: ac.signal,
    });
    const reader = res.body!.getReader();
    let seen = '';
    while (!seen.includes('event: delta')) seen += new TextDecoder().decode((await reader.read()).value);
    ac.abort();

    await waitFor(() => t.deps.limiter.inFlight === 0 && ollama.upstreamClosed);
    await waitFor(async () => (await t.deps.repos.generations.listByUser(a.userId)).length === 1);

    const rows = await t.deps.repos.generations.listByUser(a.userId);
    expect(rows[0]).toMatchObject({ conversationId: conv.id, status: 'partial', errorCode: 'aborted' });
    const assistant = (await t.deps.repos.messages.listPage(conv.id)).rows.find((m) => m.role === 'assistant');
    expect(assistant).toMatchObject({ status: 'partial' });
    expect(assistant!.content).toContain('tok0');

    ollama.mode = 'normal'; // lease must be free again
    const again = await fetch(`http://127.0.0.1:${port}/v1/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { ...a.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'again' }),
    });
    expect(again.status).toBe(200);
    await again.text();
  });
});
