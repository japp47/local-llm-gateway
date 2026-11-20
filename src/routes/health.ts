import type { FastifyPluginAsync } from 'fastify';
import { ollamaReady } from '../lib/ollama.js';
import type { Deps } from '../app.js';

export const healthRoutes: FastifyPluginAsync<{ deps: Deps }> = async (app, { deps }) => {
  // `mode` lets the CLI explain a rejected key: both modes usually listen on the same port.
  // It reveals nothing secret: no paths, versions or URLs.
  app.get('/healthz', async () => ({ ok: true, mode: deps.config.mode }));

  app.get('/readyz', async (_req, reply) => {
    const [ollama, db] = await Promise.all([
      ollamaReady(deps.config.OLLAMA_URL),
      deps.storage.ping(),
    ]);
    const ok = ollama && db;
    return reply.code(ok ? 200 : 503).send({ ok, ollama, db });
  });

  app.get('/metrics', async (_req, reply) =>
    reply
      .header('content-type', deps.metrics.registry.contentType)
      .send(await deps.metrics.registry.metrics()),
  );
};