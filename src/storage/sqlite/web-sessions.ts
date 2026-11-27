import { and, desc, eq, gt, isNotNull, isNull, lt, or } from 'drizzle-orm';
import type { CodePurpose, SessionOrigin, WebSessionInfo, WebSessionsStore } from '../ports.js';
import type { SqliteDb } from './client.js';
import { webCodes, webSessions } from './schema.js';

export class SqliteWebSessionsStore implements WebSessionsStore {
  constructor(private readonly db: SqliteDb) {}

  async createCode(userId: string, codeHash: string, expiresAt: Date, purpose: CodePurpose): Promise<void> {
    this.db.insert(webCodes).values({ userId, codeHash, expiresAt, purpose }).run();
  }

  async redeemCode(codeHash: string, now: Date): Promise<{ userId: string; purpose: CodePurpose } | null> {
    // One UPDATE ... RETURNING: SQLite runs it as a single write, so a code works once.
    const row = this.db
      .update(webCodes)
      .set({ usedAt: now })
      .where(and(eq(webCodes.codeHash, codeHash), isNull(webCodes.usedAt), gt(webCodes.expiresAt, now)))
      .returning({ userId: webCodes.userId, purpose: webCodes.purpose })
      .get();
    return row ? { userId: row.userId, purpose: row.purpose as CodePurpose } : null;
  }

  async createSession(
    userId: string,
    tokenHash: string,
    now: Date,
    expiresAt: Date,
    device: { name: string | null; createdFrom: SessionOrigin },
  ): Promise<{ id: string }> {
    return this.db
      .insert(webSessions)
      .values({ userId, tokenHash, lastSeenAt: now, expiresAt, deviceName: device.name, createdFrom: device.createdFrom })
      .returning({ id: webSessions.id })
      .get();
  }

  async findActiveSession(tokenHash: string, now: Date) {
    const row = this.db
      .select({ id: webSessions.id, userId: webSessions.userId, lastSeenAt: webSessions.lastSeenAt, createdFrom: webSessions.createdFrom })
      .from(webSessions)
      .where(and(eq(webSessions.tokenHash, tokenHash), isNull(webSessions.revokedAt), gt(webSessions.expiresAt, now)))
      .get();
    return row ? { ...row, createdFrom: row.createdFrom as SessionOrigin } : null;
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

  async listSessions(userId: string, now: Date): Promise<WebSessionInfo[]> {
    return this.db
      .select({
        id: webSessions.id,
        deviceName: webSessions.deviceName,
        createdFrom: webSessions.createdFrom,
        createdAt: webSessions.createdAt,
        lastSeenAt: webSessions.lastSeenAt,
      })
      .from(webSessions)
      .where(and(eq(webSessions.userId, userId), isNull(webSessions.revokedAt), gt(webSessions.expiresAt, now)))
      .orderBy(desc(webSessions.lastSeenAt), desc(webSessions.id))
      .all()
      .map((r) => ({ ...r, createdFrom: r.createdFrom as SessionOrigin }));
  }

  async revokeSessionById(userId: string, id: string, now: Date): Promise<boolean> {
    const rows = this.db
      .update(webSessions)
      .set({ revokedAt: now })
      .where(and(eq(webSessions.id, id), eq(webSessions.userId, userId), isNull(webSessions.revokedAt)))
      .returning({ id: webSessions.id })
      .all();
    return rows.length > 0;
  }

  async deleteExpired(before: Date): Promise<void> {
    this.db.delete(webCodes).where(or(lt(webCodes.expiresAt, before), isNotNull(webCodes.usedAt))).run();
    this.db.delete(webSessions).where(or(lt(webSessions.expiresAt, before), lt(webSessions.revokedAt, before))).run();
  }
}
