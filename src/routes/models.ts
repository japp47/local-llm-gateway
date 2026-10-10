import type { FastifyPluginAsync } from 'fastify';
import type { Deps } from '../app.js';

export const modelRoutes: FastifyPluginAsync<{ deps: Pick<Deps, 'models'> }> = async (app, { deps }) => {
  app.get('/model', async () => deps.models.getDefault());
  app.get('/models', async () => ({ data: deps.models.list() }));
};
