import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { allowedModels, config } from '../config.js';
import { limiter, QueueFullError } from '../lib/limiter.js';
import { duration, rejected, tokens, ttft } from '../plugins/metrics.js';

const Body = z.object({
  model: z.string(),
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().max(32_000),
      }),
    )
    .min(1),
  stream: z.boolean().optional().default(false),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().max(2048).optional(),
});

export const chatRoutes: FastifyPluginAsync = async (app) => {
  app.post('/chat/completions', async (req, reply) => {
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: { message: 'invalid body', details: parsed.error.flatten() } });
    }
    const body = parsed.data;
    if (!allowedModels.has(body.model)) {
      return reply.code(400).send({ error: { message: `model not allowed: ${body.model}` } });
    }

    // One AbortController covers: client disconnect, timeout, queue wait.
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), config.REQUEST_TIMEOUT_MS);
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) ac.abort();
    });

    // 1) Admission control: wait for a slot, or fail fast if the queue is full.
    let release: () => void;
    try {
      release = await limiter.acquire(ac.signal);
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof QueueFullError) {
        rejected.inc({ reason: 'queue_full' });
        return reply
          .code(503)
          .header('retry-after', '5')
          .send({ error: { message: 'server busy, retry later' } });
      }
      return reply.code(504).send({ error: { message: 'cancelled or timed out while queued' } });
    }

    // 2) We hold a slot. Always release it in `finally`.
    const started = performance.now();
    let status = 'ok';
    try {
      const upstream = await fetch(`${config.OLLAMA_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...body,
          ...(body.stream ? { stream_options: { include_usage: true } } : {}),
        }),
        signal: ac.signal,
      });

      if (!upstream.ok || !upstream.body) {
        status = 'upstream_error';
        const detail = (await upstream.text()).slice(0, 500);
        return reply
          .code(502)
          .send({ error: { message: 'upstream error', upstream_status: upstream.status, detail } });
      }

      // Non-streaming: pass JSON through, record usage.
      if (!body.stream) {
        const json = (await upstream.json()) as {
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        tokens.inc({ model: body.model, kind: 'prompt' }, json.usage?.prompt_tokens ?? 0);
        tokens.inc({ model: body.model, kind: 'completion' }, json.usage?.completion_tokens ?? 0);
        return reply.send(json);
      }

      // Streaming: pipe SSE bytes straight through.
      reply.hijack();
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });

      let first = true;
      let tail = '';
      for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
        if (first) {
          ttft.observe({ model: body.model }, (performance.now() - started) / 1000);
          first = false;
        }
        reply.raw.write(chunk);
        tail = (tail + Buffer.from(chunk).toString('utf8')).slice(-2048);
      }
      reply.raw.end();

      // usage arrives in the last chunk when stream_options is honored
      const p = /"prompt_tokens":\s*(\d+)/.exec(tail);
      const c = /"completion_tokens":\s*(\d+)/.exec(tail);
      if (p) tokens.inc({ model: body.model, kind: 'prompt' }, Number(p[1]));
      if (c) tokens.inc({ model: body.model, kind: 'completion' }, Number(c[1]));
      return reply;
    } catch (err) {
      status = ac.signal.aborted ? 'aborted' : 'error';
      req.log.warn({ err: (err as Error).message, status }, 'chat request failed');
      if (reply.raw.headersSent) {
        reply.raw.end();
      } else if (!reply.sent) {
        return reply
          .code(status === 'aborted' ? 504 : 502)
          .send({ error: { message: 'upstream failure' } });
      }
    } finally {
      clearTimeout(timeout);
      release();
      duration.observe({ model: body.model, status }, (performance.now() - started) / 1000);
    }
  });
};