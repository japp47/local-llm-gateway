// Upgrade test: build a database at the OLDEST migration, fill it with data written for
// that old schema, upgrade to the latest, and read everything back through today's code.
// Catches migrations that lose, mangle or block existing data.
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate as migratePg } from 'drizzle-orm/postgres-js/migrator';
import { migrate as migrateSqlite } from 'drizzle-orm/better-sqlite3/migrator';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { sha256 } from '../src/lib/hash.js';
import { migrationsFolder } from '../src/storage/migrations-path.js';
import type { Storage } from '../src/storage/index.js';
import { createPostgresStorage } from '../src/storage/postgres/index.js';
import { createSqliteStorage } from '../src/storage/sqlite/index.js';
import { TEST_BACKEND, TEST_DB_URL } from './helpers.js';

const temps: string[] = [];
afterAll(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A copy of a migrations folder that stops after the first `count` migrations. */
function firstMigrations(folder: string, count: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'llmgw-migrations-'));
  temps.push(dir);
  const journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8'));
  journal.entries = journal.entries.slice(0, count);
  mkdirSync(join(dir, 'meta'));
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify(journal));
  for (const e of journal.entries) copyFileSync(join(folder, `${e.tag}.sql`), join(dir, `${e.tag}.sql`));
  return dir;
}

const KEY = 'llmgw_upgrade_test_key';

/** Reads the seeded data back through today's storage code, after the upgrade. */
async function expectSeedSurvived(storage: Storage, ids: { conv: string }) {
  const user = await storage.users.findByEmail('old@example.com');
  expect(user).not.toBeNull();
  expect(await storage.apiKeys.findActiveByHash(sha256(KEY))).toMatchObject({ userId: user!.id });

  const conv = await storage.conversations.get(user!.id, ids.conv);
  expect(conv).toMatchObject({ title: 'Old chat', defaultModel: 'old-model', parentConversationId: null });
  expect(conv!.updatedAt.toISOString()).toBe('2026-01-01T10:00:00.123Z');

  const page = await storage.messages.listPage(ids.conv);
  expect(page.rows.map((m) => [m.role, m.content])).toEqual([
    ['user', 'old question'],
    ['assistant', 'old answer'],
  ]);
  expect(await storage.generations.listByUser(user!.id)).toHaveLength(1);

  // Features added after the oldest migration work on old rows.
  const fork = await storage.conversations.fork({
    userId: user!.id,
    sourceConversationId: ids.conv,
    fromMessageId: page.rows[1]!.id,
  });
  expect(fork).toMatchObject({ kind: 'forked', messageCount: 2 });
  expect(await storage.conversations.list(user!.id, 10)).toHaveLength(2);
}

describe.runIf(TEST_BACKEND === 'postgres')('postgres migrations upgrade with data', () => {
  it('keeps data written at the oldest migration', async () => {
    const url = new URL(TEST_DB_URL);
    const name = `${url.pathname.slice(1)}_upgrade`;
    url.pathname = `/${name}`;
    const admin = postgres(TEST_DB_URL, { max: 1, onnotice: () => {} });
    await admin.unsafe(`drop database if exists "${name}" with (force)`);
    await admin.unsafe(`create database "${name}"`);

    const storage = createPostgresStorage(url.toString());
    const raw = postgres(url.toString(), { max: 1, onnotice: () => {} });
    try {
      await migratePg(storage.db, { migrationsFolder: firstMigrations(migrationsFolder(''), 1) });
      const forkColumns = await raw`
        select 1 from information_schema.columns
        where table_name = 'conversations' and column_name = 'parent_conversation_id'`;
      expect(forkColumns).toHaveLength(0); // really on the old schema

      // Written for the 0000 schema: no fork columns, microsecond updated_at.
      const [user] = await raw`insert into users (email) values ('old@example.com') returning id`;
      await raw`insert into api_keys (user_id, key_hash) values (${user!.id}, ${sha256(KEY)})`;
      const [conv] = await raw`
        insert into conversations (user_id, title, default_model, updated_at)
        values (${user!.id}, 'Old chat', 'old-model', '2026-01-01 10:00:00.1234+00') returning id`;
      await raw`insert into messages (conversation_id, role, content) values (${conv!.id}, 'user', 'old question')`;
      await raw`insert into messages (conversation_id, role, content) values (${conv!.id}, 'assistant', 'old answer')`;
      await raw`
        insert into generations (request_id, user_id, conversation_id, provider, model, status)
        values ('req_old', ${user!.id}, ${conv!.id}, 'ollama', 'old-model', 'complete')`;

      await storage.migrate(); // to the latest
      await expectSeedSurvived(storage, { conv: conv!.id });
    } finally {
      await raw.end();
      await storage.close();
      await admin.unsafe(`drop database if exists "${name}" with (force)`);
      await admin.end();
    }
  });
});

describe.runIf(TEST_BACKEND === 'sqlite')('sqlite migrations upgrade with data', () => {
  it('keeps data written at the oldest migration', async () => {
    const storage = createSqliteStorage(':memory:');
    try {
      migrateSqlite(storage.db, { migrationsFolder: firstMigrations(migrationsFolder('sqlite'), 1) });

      // Written for the 0000 schema with plain SQL: text ids, integer-millisecond timestamps.
      const now = Date.now();
      const [userId, keyId, convId] = [randomUUID(), randomUUID(), randomUUID()];
      storage.db.run(sql`insert into users (id, email, created_at) values (${userId}, 'old@example.com', ${now})`);
      storage.db.run(sql`
        insert into api_keys (id, user_id, key_hash, created_at) values (${keyId}, ${userId}, ${sha256(KEY)}, ${now})`);
      storage.db.run(sql`
        insert into conversations (id, user_id, title, default_model, created_at, updated_at)
        values (${convId}, ${userId}, 'Old chat', 'old-model', ${now}, ${Date.parse('2026-01-01T10:00:00.123Z')})`);
      for (const [role, content] of [['user', 'old question'], ['assistant', 'old answer']]) {
        storage.db.run(sql`
          insert into messages (id, conversation_id, role, content, created_at)
          values (${randomUUID()}, ${convId}, ${role}, ${content}, ${now})`);
      }
      storage.db.run(sql`
        insert into generations (id, request_id, user_id, conversation_id, provider, model, status, created_at)
        values (${randomUUID()}, 'req_old', ${userId}, ${convId}, 'ollama', 'old-model', 'complete', ${now})`);

      await storage.migrate(); // to the latest
      await expectSeedSurvived(storage, { conv: convId });
    } finally {
      await storage.close();
    }
  });
});
