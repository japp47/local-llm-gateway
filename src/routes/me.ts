import type { FastifyPluginAsync } from 'fastify';
import type { Deps } from '../app.js';
import { AppError } from '../lib/errors.js';

export const meRoutes: FastifyPluginAsync<{ deps: Deps }> = async (
  app,
  { deps },
) => {
  app.get('/me', async (req) => {
    const userId = req.auth!.userId;

    const user = await deps.repos.users.findById(userId);

    if (!user) {
      throw new AppError(
        404,
        'user_not_found',
        'user not found',
      );
    }

    return {
      id: user.id,
      email: user.email,
    };
  });
};