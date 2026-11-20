import type { FastifyPluginAsync } from 'fastify';
import { StatsQuery as Query } from '../api/schemas.js';
import type { Deps } from '../app.js';

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
