// Legacy stateless passthrough. Kept working while conversations are built beside it.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import { AppError } from '../lib/errors.js';
import { QueueFullError } from '../lib/semaphore.js';
import { writeChunk } from '../lib/sse.js';

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

export const chatRoutes: FastifyPluginAsync<{ deps: Deps }> = async (app, { deps }) => {
  const { config, limiter, metrics } = deps;

  app.post('/chat/completions', async (req, reply) => {
    const body = Body.parse(req.body);
    if (!config.allowedModels.has(body.model)) {
      throw new AppError(400, 'model_not_allowed', `model not allowed: ${body.model}`);
    }

    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), config.REQUEST_TIMEOUT_MS);
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) ac.abort();
    });

    let release: () => void;
    try {
      release = await limiter.acquire(ac.signal);
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof QueueFullError) {
        metrics.rejected.inc({ reason: 'queue_full' });
        throw new AppError(503, 'server_busy', 'server busy, retry later', { 'retry-after': '5' });
      }
      throw new AppError(504, 'cancelled', 'cancelled or timed out while queued');
    }

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
        return reply.code(502).send({
          error: { code: 'upstream_error', message: detail, request_id: req.id },
        });
      }

      if (!body.stream) {
        const json = (await upstream.json()) as {
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        metrics.tokens.inc({ model: body.model, kind: 'prompt' }, json.usage?.prompt_tokens ?? 0);
        metrics.tokens.inc(
          { model: body.model, kind: 'completion' },
          json.usage?.completion_tokens ?? 0,
        );
        return reply.send(json);
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
        'x-request-id': req.id, // hijacked replies skip Fastify's onSend hooks
      });

      let first = true;
      let tail = '';
      for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
        if (first) {
          metrics.ttft.observe({ model: body.model }, (performance.now() - started) / 1000);
          first = false;
        }
        await writeChunk(reply.raw, chunk);
        tail = (tail + Buffer.from(chunk).toString('utf8')).slice(-2048);
      }
      reply.raw.end();

      const p = /"prompt_tokens":\s*(\d+)/.exec(tail);
      const c = /"completion_tokens":\s*(\d+)/.exec(tail);
      if (p) metrics.tokens.inc({ model: body.model, kind: 'prompt' }, Number(p[1]));
      if (c) metrics.tokens.inc({ model: body.model, kind: 'completion' }, Number(c[1]));
      return reply;
    } catch (err) {
      status = ac.signal.aborted ? 'aborted' : 'error';
      req.log.warn({ err: (err as Error).message, status }, 'chat request failed');
      if (reply.raw.headersSent) {
        reply.raw.end();
        return reply;
      }
      throw new AppError(status === 'aborted' ? 504 : 502, 'upstream_failure', 'upstream failure');
    } finally {
      clearTimeout(timeout);
      release();
      metrics.duration.observe({ model: body.model, status }, (performance.now() - started) / 1000);
    }
  });
};