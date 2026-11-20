// Backup and restore for single-user mode. All chats live in one SQLite file, so a backup
// is a checked copy of that file and a restore puts one back.
//
// Backup runs inside the gateway (it owns the database; the future "Back up now" button
// calls the same code through POST /v1/backup). Restore runs while the gateway is stopped
// (`npm run restore -- <file>`): a database can't be swapped under a running app. It never
// deletes anything: the database it replaces is moved aside first.
import { chmodSync, copyFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import Database from 'better-sqlite3';
import type { config } from '../config.js';
import { acquireInstanceLock, StartupError } from '../lib/instance-lock.js';
import { lockPath, sqlitePath, type Storage } from '../storage/index.js';
import { availableMigrations } from '../storage/migrations-path.js';

export interface BackupSummary {
  file: string;
  conversations: number;
  messages: number;
  bytes: number;
  createdAt: string;
}

/** A problem the user can fix; the message says how. */
export class BackupError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

export const backupsDir = (config: config) => join(config.dataDir, 'backups');

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15); // 20261120-193005

type Inspection =
  | { ok: true; conversations: number; messages: number; migrations: number }
  | { ok: false; reason: string };

/** Opens a file read-only and checks it is a healthy gateway database. */
export function inspectBackup(file: string): Inspection {
  if (!existsSync(file)) return { ok: false, reason: `There is no file at ${file}.` };
  let db: Database.Database | undefined;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    if (db.pragma('integrity_check', { simple: true }) !== 'ok') {
      return { ok: false, reason: 'The file is damaged (SQLite integrity check failed).' };
    }
    const has = (t: string) => !!db!.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(t);
    if (!has('conversations') || !has('messages') || !has('__drizzle_migrations')) {
      return { ok: false, reason: "The file is a SQLite database, but not one of the assistant's." };
    }
    const count = (sql: string) => (db!.prepare(sql).get() as { n: number }).n;
    return {
      ok: true,
      conversations: count('select count(*) as n from conversations'),
      messages: count('select count(*) as n from messages'),
      migrations: count('select count(*) as n from __drizzle_migrations'),
    };
  } catch {
    return { ok: false, reason: "The file isn't an assistant backup (it can't be opened as a database)." };
  } finally {
    db?.close();
  }
}

/** Writes a checked backup to DATA_DIR/backups/gateway-<time>.db (0600: it holds every chat). */
export async function createBackup(storage: Storage, config: config, now = new Date()): Promise<BackupSummary> {
  if (config.mode !== 'single' || !storage.backup) {
    throw new BackupError(
      'This gateway uses a shared Postgres database, which is backed up with Postgres tools.',
      'Run: docker compose exec -T postgres pg_dump -U llmgw -Fc llmgw > llmgw.dump',
    );
  }
  const dir = backupsDir(config);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  let file = join(dir, `gateway-${stamp(now)}.db`);
  for (let i = 2; existsSync(file); i++) file = join(dir, `gateway-${stamp(now)}-${i}.db`);
  const tmp = `${file}.partial`;

  try {
    await storage.backup(tmp);
    chmodSync(tmp, 0o600);
    // One self-contained file: no -wal/-shm companions to forget when copying it around.
    const db = new Database(tmp);
    db.pragma('journal_mode = DELETE');
    db.close();
    const check = inspectBackup(tmp);
    if (!check.ok) throw new BackupError(`The backup could not be verified: ${check.reason}`);
    renameSync(tmp, file);
    return {
      file,
      conversations: check.conversations,
      messages: check.messages,
      bytes: statSync(file).size,
      createdAt: now.toISOString(),
    };
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp);
  }
}

export interface RestoreSummary {
  conversations: number;
  messages: number;
  /** Where the database that was replaced now lives; absent if there was none. */
  previous?: string;
}

/** Puts a backup in place of the current database. The gateway must not be running. */
export function restoreBackup(config: config, file: string, now = new Date()): RestoreSummary {
  if (config.mode !== 'single') {
    throw new BackupError(
      'Restore works for the single-user database only, and DATABASE_URL is set (server mode).',
      'For the single-user database: DATABASE_URL= npm run restore -- <file>. For Postgres: docker compose exec -T postgres pg_restore -U llmgw -d llmgw --clean < llmgw.dump',
    );
  }
  const check = inspectBackup(file);
  if (!check.ok) throw new BackupError(check.reason);
  if (check.migrations > availableMigrations('sqlite')) {
    throw new BackupError('This backup was made by a newer version of the assistant.', 'Update the assistant, then restore again.');
  }

  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  let release: () => void;
  try {
    // Holding the lock also stops a gateway from starting halfway through the restore.
    release = acquireInstanceLock(lockPath(config), { restoring: basename(file) });
  } catch (err) {
    if (!(err instanceof StartupError)) throw err;
    throw new BackupError('The assistant is running. Stop it first, then restore.', 'Press Ctrl+C in its window (or quit the app), then run the restore again.');
  }

  try {
    const target = sqlitePath(config);
    let previous: string | undefined;
    if (existsSync(target)) {
      mkdirSync(backupsDir(config), { recursive: true, mode: 0o700 });
      previous = join(backupsDir(config), `before-restore-${stamp(now)}.db`);
      // Move the database together with its WAL files, so nothing written last is lost.
      for (const suffix of ['', '-wal', '-shm']) {
        if (existsSync(target + suffix)) renameSync(target + suffix, previous + suffix);
      }
    }
    const tmp = `${target}.restoring`;
    copyFileSync(file, tmp);
    chmodSync(tmp, 0o600);
    renameSync(tmp, target);
    return { conversations: check.conversations, messages: check.messages, ...(previous ? { previous } : {}) };
  } finally {
    release();
  }
}
