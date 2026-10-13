import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export type SqliteDb = BetterSQLite3Database<typeof schema>;

/** Opens (or creates) the database file. `:memory:` gives a private in-memory database. */
export function openSqlite(path: string) {
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL'); // readers do not block the writer
  sqlite.pragma('synchronous = NORMAL'); // safe with WAL: a crash never corrupts the file
  sqlite.pragma('foreign_keys = ON'); // off by default in SQLite; cascades depend on it
  sqlite.pragma('busy_timeout = 5000');
  return { sqlite, db: drizzle({ client: sqlite, schema }) };
}
