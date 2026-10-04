import type { FastifyPluginAsync } from 'fastify';
import { ollamaReady } from '../lib/ollama.js';
import { registry } from '../plugins/metrics.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/healthz', async () => ({ ok: true }));

  app.get('/readyz', async (_req, reply) =>
    (await ollamaReady())
      ? { ok: true }
      : reply.code(503).send({ ok: false, reason: 'ollama_unreachable' }),
  );

  app.get('/metrics', async (_req, reply) =>
    reply.header('content-type', registry.contentType).send(await registry.metrics()),
  );
};