import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import type { ApiKeysStore, UsersStore } from '../ports.js';
import type { ApiKey, User } from '../types.js';
import { apiKeys, users } from './schema.js';

export class PgUsersStore implements UsersStore {
  constructor(private readonly db: Db) {}

  async findByEmail(email: string): Promise<User | null> {
    const [row] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return row ?? null;
  }

  async create(email: string): Promise<User> {
    const [row] = await this.db.insert(users).values({ email }).returning();
    return row!;
  }

  async findById(id: string): Promise<User | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ?? null;
  }
}

export class PgApiKeysStore implements ApiKeysStore {
  constructor(private readonly db: Db) {}

  async create(userId: string, keyHash: string, label?: string): Promise<ApiKey> {
    const [row] = await this.db.insert(apiKeys).values({ userId, keyHash, label }).returning();
    return row!;
  }

  async findActiveByHash(keyHash: string): Promise<{ id: string; userId: string } | null> {
    const [row] = await this.db
      .select({ id: apiKeys.id, userId: apiKeys.userId })
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
      .limit(1);
    return row ?? null;
  }

  async revoke(id: string): Promise<boolean> {
    const rows = await this.db
      .update(apiKeys)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id });
    return rows.length > 0;
  }

  async listForUser(userId: string): Promise<ApiKey[]> {
    return this.db.select().from(apiKeys).where(eq(apiKeys.userId, userId)).orderBy(asc(apiKeys.createdAt));
  }
}