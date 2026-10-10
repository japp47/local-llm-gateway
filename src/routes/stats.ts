import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';

const Query = z.object({
  hours: z.coerce.number().int().min(1).max(720).default(24),
  recent: z.coerce.number().int().min(0).max(50).default(5),
});

/** Usage numbers for the calling user only: other users' generations are never included. */
export const statsRoutes: FastifyPluginAsync<{ deps: Pick<Deps, 'repos'> }> = async (app, { deps }) => {
  app.get('/stats', async (req) => {
    const q = Query.parse(req.query);
    const userId = req.auth!.userId;
    const since = new Date(Date.now() - q.hours * 3_600_000);
    const [models, recent] = await Promise.all([
      deps.repos.generations.statsByModel(userId, since),
      deps.repos.generations.recent(userId, q.recent, since),
    ]);
    return { hours: q.hours, since: since.toISOString(), models, recent };
  });
};
