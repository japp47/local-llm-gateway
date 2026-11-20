import type { FastifyPluginAsync } from 'fastify';
import type { Deps } from '../app.js';
import { AppError } from '../lib/errors.js';
import { BackupError, createBackup } from '../services/backup.js';

/**
 * POST /v1/backup: writes a checked copy of the single-user database into the data folder
 * and says where. The client never chooses the path, so the API can't write elsewhere.
 */
export const backupRoutes: FastifyPluginAsync<{ deps: Deps }> = async (app, { deps }) => {
  app.post('/backup', async (_req, reply) => {
    try {
      return reply.code(201).send(await createBackup(deps.storage, deps.config));
    } catch (err) {
      if (err instanceof BackupError) {
        throw new AppError(deps.config.mode === 'server' ? 409 : 500, 'backup_failed', err.message, { hint: err.hint });
      }
      throw err;
    }
  });
};
