import { and, eq, gt, isNotNull, isNull, lt, or } from 'drizzle-orm';
import type { WebSessionsStore } from '../ports.js';
import type { Db } from './client.js';
import { webCodes, webSessions } from './schema.js';

export class PgWebSessionsStore implements WebSessionsStore {
  constructor(private readonly db: Db) {}

  async createCode(userId: string, codeHash: string, expiresAt: Date): Promise<void> {
    await this.db.insert(webCodes).values({ userId, codeHash, expiresAt });
  }

  async redeemCode(codeHash: string, now: Date): Promise<{ userId: string } | null> {
    // One UPDATE: two concurrent redeems can't both see "unused" (row lock on update).
    const [row] = await this.db
      .update(webCodes)
      .set({ usedAt: now })
      .where(and(eq(webCodes.codeHash, codeHash), isNull(webCodes.usedAt), gt(webCodes.expiresAt, now)))
      .returning({ userId: webCodes.userId });
    return row ?? null;
  }

  async createSession(userId: string, tokenHash: string, now: Date, expiresAt: Date): Promise<{ id: string }> {
    const [row] = await this.db
      .insert(webSessions)
      .values({ userId, tokenHash, lastSeenAt: now, expiresAt })
      .returning({ id: webSessions.id });
    return row!;
  }

  async findActiveSession(tokenHash: string, now: Date) {
    const [row] = await this.db
      .select({ id: webSessions.id, userId: webSessions.userId, lastSeenAt: webSessions.lastSeenAt })
      .from(webSessions)
      .where(and(eq(webSessions.tokenHash, tokenHash), isNull(webSessions.revokedAt), gt(webSessions.expiresAt, now)))
      .limit(1);
    return row ?? null;
  }

  async touchSession(id: string, now: Date, expiresAt: Date): Promise<void> {
    await this.db.update(webSessions).set({ lastSeenAt: now, expiresAt }).where(eq(webSessions.id, id));
  }

  async revokeSession(tokenHash: string, now: Date): Promise<boolean> {
    const rows = await this.db
      .update(webSessions)
      .set({ revokedAt: now })
      .where(and(eq(webSessions.tokenHash, tokenHash), isNull(webSessions.revokedAt)))
      .returning({ id: webSessions.id });
    return rows.length > 0;
  }

  async deleteExpired(before: Date): Promise<void> {
    await this.db.delete(webCodes).where(or(lt(webCodes.expiresAt, before), isNotNull(webCodes.usedAt)));
    await this.db.delete(webSessions).where(or(lt(webSessions.expiresAt, before), lt(webSessions.revokedAt, before)));
  }
}
