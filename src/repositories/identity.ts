import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { apiKeys, users } from '../db/schema.js';

export class UsersRepo {
  constructor(private readonly db: Db) {}

  async findByEmail(email: string) {
    const [row] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return row ?? null;
  }

  async create(email: string) {
    const [row] = await this.db.insert(users).values({ email }).returning();
    return row!;
  }

  async findById(id: string) {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))

    return row ?? null;
  }
}

export class ApiKeysRepo {
  constructor(private readonly db: Db) {}

  async create(userId: string, keyHash: string, label?: string) {
    const [row] = await this.db.insert(apiKeys).values({ userId, keyHash, label }).returning();
    return row!;
  }

  async findActiveByHash(keyHash: string) {
    const [row] = await this.db
      .select({ id: apiKeys.id, userId: apiKeys.userId })
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
      .limit(1);
    return row ?? null;
  }
}