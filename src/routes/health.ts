import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { ollamaReady } from '../lib/ollama.js';
import type { Deps } from '../app.js';

export const healthRoutes: FastifyPluginAsync<{ deps: Deps }> = async (app, { deps }) => {
  app.get('/healthz', async () => ({ ok: true }));

  app.get('/readyz', async (_req, reply) => {
    const [ollama, db] = await Promise.all([
      ollamaReady(deps.config.OLLAMA_URL),
      deps.db.execute(sql`select 1`).then(() => true, () => false),
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