import { and, desc, eq, gt, isNotNull, isNull, lt, or } from 'drizzle-orm';
import type { CodePurpose, SessionOrigin, WebSessionInfo, WebSessionsStore } from '../ports.js';
import type { Db } from './client.js';
import { webCodes, webSessions } from './schema.js';

export class PgWebSessionsStore implements WebSessionsStore {
  constructor(private readonly db: Db) {}

  async createCode(userId: string, codeHash: string, expiresAt: Date, purpose: CodePurpose): Promise<void> {
    await this.db.insert(webCodes).values({ userId, codeHash, expiresAt, purpose });
  }

  async redeemCode(codeHash: string, now: Date): Promise<{ userId: string; purpose: CodePurpose } | null> {
    // One UPDATE: two concurrent redeems can't both see "unused" (row lock on update).
    const [row] = await this.db
      .update(webCodes)
      .set({ usedAt: now })
      .where(and(eq(webCodes.codeHash, codeHash), isNull(webCodes.usedAt), gt(webCodes.expiresAt, now)))
      .returning({ userId: webCodes.userId, purpose: webCodes.purpose });
    return row ? { userId: row.userId, purpose: row.purpose as CodePurpose } : null;
  }

  async createSession(
    userId: string,
    tokenHash: string,
    now: Date,
    expiresAt: Date,
    device: { name: string | null; createdFrom: SessionOrigin },
  ): Promise<{ id: string }> {
    const [row] = await this.db
      .insert(webSessions)
      .values({ userId, tokenHash, lastSeenAt: now, expiresAt, deviceName: device.name, createdFrom: device.createdFrom })
      .returning({ id: webSessions.id });
    return row!;
  }

  async findActiveSession(tokenHash: string, now: Date) {
    const [row] = await this.db
      .select({ id: webSessions.id, userId: webSessions.userId, lastSeenAt: webSessions.lastSeenAt, createdFrom: webSessions.createdFrom })
      .from(webSessions)
      .where(and(eq(webSessions.tokenHash, tokenHash), isNull(webSessions.revokedAt), gt(webSessions.expiresAt, now)))
      .limit(1);
    return row ? { ...row, createdFrom: row.createdFrom as SessionOrigin } : null;
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

  async listSessions(userId: string, now: Date): Promise<WebSessionInfo[]> {
    const rows = await this.db
      .select({
        id: webSessions.id,
        deviceName: webSessions.deviceName,
        createdFrom: webSessions.createdFrom,
        createdAt: webSessions.createdAt,
        lastSeenAt: webSessions.lastSeenAt,
      })
      .from(webSessions)
      .where(and(eq(webSessions.userId, userId), isNull(webSessions.revokedAt), gt(webSessions.expiresAt, now)))
      .orderBy(desc(webSessions.lastSeenAt), desc(webSessions.id));
    return rows.map((r) => ({ ...r, createdFrom: r.createdFrom as SessionOrigin }));
  }

  async revokeSessionById(userId: string, id: string, now: Date): Promise<boolean> {
    const rows = await this.db
      .update(webSessions)
      .set({ revokedAt: now })
      .where(and(eq(webSessions.id, id), eq(webSessions.userId, userId), isNull(webSessions.revokedAt)))
      .returning({ id: webSessions.id });
    return rows.length > 0;
  }

  async deleteExpired(before: Date): Promise<void> {
    await this.db.delete(webCodes).where(or(lt(webCodes.expiresAt, before), isNotNull(webCodes.usedAt)));
    await this.db.delete(webSessions).where(or(lt(webSessions.expiresAt, before), lt(webSessions.revokedAt, before)));
  }
}
