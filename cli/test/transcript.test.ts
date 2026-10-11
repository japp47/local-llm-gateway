import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient } from '../src/api.js';

const msg = (seq: number) => ({
  id: `m${seq}`, seq, role: seq % 2 ? 'user' : 'assistant', content: `message ${seq}`, status: 'complete', model: null, createdAt: '2026-01-01T00:00:00Z',
});

describe('ApiClient.getConversation paging', () => {
  let server: Server;
  let base = '';
  let urls: string[] = [];
  let handler: (url: URL, res: ServerResponse) => void;

  beforeEach(async () => {
    urls = [];
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      urls.push(req.url!);
      handler(new URL(req.url!, 'http://x'), res);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const send = (res: ServerResponse, body: unknown) =>
    void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  const client = () => new ApiClient({ baseUrl: base, apiKey: 'llmgw_test' });

  it('follows nextAfter until the transcript is complete, in order', async () => {
    const base0 = { id: 'c1', title: 'long', defaultModel: 'm', systemPrompt: null, parentConversationId: null, forkedFromMessageId: null, createdAt: 'x', updatedAt: 'x', messageCount: 5 };
    handler = (url, res) => {
      const after = Number(url.searchParams.get('after'));
      if (after === 0) return send(res, { ...base0, messages: [msg(1), msg(2)], nextAfter: 2 });
      if (after === 2) return send(res, { ...base0, messages: [msg(3), msg(4)], nextAfter: 4 });
      return send(res, { ...base0, messages: [msg(5)], nextAfter: null });
    };

    const t = await client().getConversation('c1');
    expect(t.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(t.messageCount).toBe(5);
    expect('nextAfter' in t).toBe(false);
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain('limit=500');
  });

  it('still works against an older gateway that returns everything with no paging fields', async () => {
    handler = (_url, res) =>
      send(res, { id: 'c1', title: null, defaultModel: 'm', systemPrompt: null, parentConversationId: null, forkedFromMessageId: null, createdAt: 'x', updatedAt: 'x', messages: [msg(1), msg(2)] });
    const t = await client().getConversation('c1');
    expect(t.messages).toHaveLength(2);
    expect(urls).toHaveLength(1);
  });
});
