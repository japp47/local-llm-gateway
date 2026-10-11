import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Storage } from '../ports.js';
import { createDb, type Db } from './client.js';
import { PgConversationsStore } from './conversations.js';
import { PgGenerationsStore } from './generations.js';
import { PgApiKeysStore, PgUsersStore } from './identity.js';
import { PgMessagesStore } from './messages.js';

export interface PostgresStorage extends Storage {
  /** Raw drizzle handle for tests and scripts. Routes and services only see `Storage`. */
  readonly db: Db;
}

export function createPostgresStorage(url: string): PostgresStorage {
  const { db, close } = createDb(url);
  return {
    db,
    users: new PgUsersStore(db),
    apiKeys: new PgApiKeysStore(db),
    conversations: new PgConversationsStore(db),
    messages: new PgMessagesStore(db),
    generations: new PgGenerationsStore(db),
    ping: () => db.execute(sql`select 1`).then(() => true, () => false),
    migrate: () => migrate(db, { migrationsFolder: './drizzle' }),
    close,
  };
}
