import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { migrationsFolder } from '../migrations-path.js';
import type { Storage } from '../ports.js';
import { openSqlite, type SqliteDb } from './client.js';
import { SqliteConversationsStore } from './conversations.js';
import { SqliteGenerationsStore } from './generations.js';
import { SqliteApiKeysStore, SqliteUsersStore } from './identity.js';
import { SqliteMessagesStore } from './messages.js';

export interface SqliteStorage extends Storage {
  /** Raw drizzle handle for tests and scripts. Routes and services only see `Storage`. */
  readonly db: SqliteDb;
}

/** `path` is a database file, or `:memory:` for a private in-memory database (tests). */
export function createSqliteStorage(path: string): SqliteStorage {
  const { sqlite, db } = openSqlite(path);
  return {
    db,
    users: new SqliteUsersStore(db),
    apiKeys: new SqliteApiKeysStore(db),
    conversations: new SqliteConversationsStore(db),
    messages: new SqliteMessagesStore(db),
    generations: new SqliteGenerationsStore(db),
    ping: async () => {
      try {
        sqlite.prepare('select 1').get();
        return true;
      } catch {
        return false;
      }
    },
    migrate: async () => migrate(db, { migrationsFolder: migrationsFolder('sqlite') }),
    close: async () => {
      sqlite.close();
    },
  };
}
