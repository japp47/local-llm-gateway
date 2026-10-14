import { and, asc, eq, isNull } from 'drizzle-orm';
import type { ApiKeysStore, UsersStore } from '../ports.js';
import type { ApiKey, User } from '../types.js';
import type { SqliteDb } from './client.js';
import { apiKeys, users } from './schema.js';

export class SqliteUsersStore implements UsersStore {
  constructor(private readonly db: SqliteDb) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.db.select().from(users).where(eq(users.email, email)).get() ?? null;
  }

  async create(email: string): Promise<User> {
    return this.db.insert(users).values({ email }).returning().get();
  }

  async findById(id: string): Promise<User | null> {
    return this.db.select().from(users).where(eq(users.id, id)).get() ?? null;
  }
}

export class SqliteApiKeysStore implements ApiKeysStore {
  constructor(private readonly db: SqliteDb) {}

  async create(userId: string, keyHash: string, label?: string): Promise<ApiKey> {
    return this.db.insert(apiKeys).values({ userId, keyHash, label }).returning().get();
  }

  async findActiveByHash(keyHash: string): Promise<{ id: string; userId: string } | null> {
    return (
      this.db
        .select({ id: apiKeys.id, userId: apiKeys.userId })
        .from(apiKeys)
        .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
        .get() ?? null
    );
  }

  async revoke(id: string): Promise<boolean> {
    const rows = this.db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id })
      .all();
    return rows.length > 0;
  }

  async listForUser(userId: string): Promise<ApiKey[]> {
    return this.db.select().from(apiKeys).where(eq(apiKeys.userId, userId)).orderBy(asc(apiKeys.createdAt)).all();
  }
}
