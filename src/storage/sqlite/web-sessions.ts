import { and, eq, gt, isNotNull, isNull, lt, or } from 'drizzle-orm';
import type { WebSessionsStore } from '../ports.js';
import type { SqliteDb } from './client.js';
import { webCodes, webSessions } from './schema.js';

export class SqliteWebSessionsStore implements WebSessionsStore {
  constructor(private readonly db: SqliteDb) {}

  async createCode(userId: string, codeHash: string, expiresAt: Date): Promise<void> {
    this.db.insert(webCodes).values({ userId, codeHash, expiresAt }).run();
  }

  async redeemCode(codeHash: string, now: Date): Promise<{ userId: string } | null> {
    // One UPDATE ... RETURNING: SQLite runs it as a single write, so a code works once.
    return (
      this.db
        .update(webCodes)
        .set({ usedAt: now })
        .where(and(eq(webCodes.codeHash, codeHash), isNull(webCodes.usedAt), gt(webCodes.expiresAt, now)))
        .returning({ userId: webCodes.userId })
        .get() ?? null
    );
  }

  async createSession(userId: string, tokenHash: string, now: Date, expiresAt: Date): Promise<{ id: string }> {
    return this.db
      .insert(webSessions)
      .values({ userId, tokenHash, lastSeenAt: now, expiresAt })
      .returning({ id: webSessions.id })
      .get();
  }

  async findActiveSession(tokenHash: string, now: Date) {
    return (
      this.db
        .select({ id: webSessions.id, userId: webSessions.userId, lastSeenAt: webSessions.lastSeenAt })
        .from(webSessions)
        .where(and(eq(webSessions.tokenHash, tokenHash), isNull(webSessions.revokedAt), gt(webSessions.expiresAt, now)))
        .get() ?? null
    );
  }

  async touchSession(id: string, now: Date, expiresAt: Date): Promise<void> {
    this.db.update(webSessions).set({ lastSeenAt: now, expiresAt }).where(eq(webSessions.id, id)).run();
  }

  async revokeSession(tokenHash: string, now: Date): Promise<boolean> {
    const rows = this.db
      .update(webSessions)
      .set({ revokedAt: now })
      .where(and(eq(webSessions.tokenHash, tokenHash), isNull(webSessions.revokedAt)))
      .returning({ id: webSessions.id })
      .all();
    return rows.length > 0;
  }

  async deleteExpired(before: Date): Promise<void> {
    this.db.delete(webCodes).where(or(lt(webCodes.expiresAt, before), isNotNull(webCodes.usedAt))).run();
    this.db.delete(webSessions).where(or(lt(webSessions.expiresAt, before), lt(webSessions.revokedAt, before))).run();
  }
}
