import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { availableMigrations, migrationsFolder } from '../migrations-path.js';
import type { Storage } from '../ports.js';
import { createDb, type Db } from './client.js';
import { PgConversationsStore } from './conversations.js';
import { PgGenerationsStore } from './generations.js';
import { PgApiKeysStore, PgUsersStore } from './identity.js';
import { PgMessagesStore } from './messages.js';
import { PgWebSessionsStore } from './web-sessions.js';

export interface PostgresStorage extends Storage {
  /** Raw drizzle handle for tests and scripts. Routes and services only see `Storage`. */
  readonly db: Db;
}

export function createPostgresStorage(url: string): PostgresStorage {
  const { db, close } = createDb(url);
  return {
    db,
    users: new PgUsersStore(db),
    webSessions: new PgWebSessionsStore(db),
    apiKeys: new PgApiKeysStore(db),
    conversations: new PgConversationsStore(db),
    messages: new PgMessagesStore(db),
    generations: new PgGenerationsStore(db),
    ping: () => db.execute(sql`select 1`).then(() => true, () => false),
    migrate: () => migrate(db, { migrationsFolder: migrationsFolder('') }),
    migrationStatus: async () => {
      const exists = await db.execute<{ t: string | null }>(sql`select to_regclass('drizzle.__drizzle_migrations')::text as t`);
      const applied = exists[0]?.t
        ? Number((await db.execute<{ n: string }>(sql`select count(*) as n from drizzle.__drizzle_migrations`))[0]?.n ?? 0)
        : 0;
      return { applied, available: availableMigrations('') };
    },
    close,
  };
}
