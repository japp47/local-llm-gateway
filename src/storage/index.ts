import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { config } from '../config.js';
import { acquireInstanceLock } from '../lib/instance-lock.js';
import type { Storage } from './ports.js';
import { createPostgresStorage } from './postgres/index.js';
import { createSqliteStorage } from './sqlite/index.js';

export type * from './ports.js';
export type * from './types.js';

export const sqlitePath = (config: config) => join(config.dataDir, 'gateway.db');
export const lockPath = (config: config) => join(config.dataDir, 'gateway.lock');

/**
 * The only place that decides which storage backend runs.
 * - Server mode (DATABASE_URL set): Postgres. Migrations stay a deliberate step
 *   (`npm run db:migrate`), because the database may be shared.
 * - Single-user mode: SQLite in the data folder, created and migrated on the spot, so a
 *   first run needs no setup. A lock file keeps a second gateway off the same file.
 */
export async function openStorage(config: config): Promise<Storage> {
  if (config.DATABASE_URL) return createPostgresStorage(config.DATABASE_URL);

  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 }); // chat history is private
  const release = acquireInstanceLock(lockPath(config), { port: config.PORT });
  try {
    const storage = createSqliteStorage(sqlitePath(config));
    chmodSync(sqlitePath(config), 0o600); // SQLite gives its -wal/-shm files the same mode
    await storage.migrate();
    return {
      ...storage,
      close: async () => {
        try {
          await storage.close();
        } finally {
          release();
        }
      },
    };
  } catch (err) {
    release();
    throw err;
  }
}
