import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { conversations } from '../db/schema.js';

export type Conversation = typeof conversations.$inferSelect;

export class ConversationsRepo {
  constructor(private readonly db: Db) {}

  async create(v: { userId: string; defaultModel: string; title?: string; systemPrompt?: string }) {
    const [row] = await this.db.insert(conversations).values(v).returning();
    return row!;
  }

  /** Always scoped by user: a conversation id alone never grants access. */
  async get(userId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  async list(userId: string, limit: number, before?: Date) {
    return this.db
      .select()
      .from(conversations)
      .where(
        before
          ? and(eq(conversations.userId, userId), lt(conversations.updatedAt, before))
          : eq(conversations.userId, userId),
      )
      .orderBy(desc(conversations.updatedAt))
      .limit(limit);
  }

  async rename(userId: string, id: string, title: string) {
    const [row] = await this.db
      .update(conversations)
      .set({ title, updatedAt: sql`now()` })
      .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
      .returning();
    return row ?? null;
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
      .returning({ id: conversations.id });
    return rows.length > 0;
  }

  /** Atomic compare-and-set lease: succeeds only if nobody holds an unexpired lease. */
  async acquireLease(id: string, seconds: number): Promise<boolean> {
    const rows = await this.db
      .update(conversations)
      .set({ leaseUntil: sql`now() + make_interval(secs => ${seconds})` })
      .where(
        and(
          eq(conversations.id, id),
          or(isNull(conversations.leaseUntil), lt(conversations.leaseUntil, sql`now()`)),
        ),
      )
      .returning({ id: conversations.id });
    return rows.length > 0;
  }

  async releaseLease(id: string) {
    await this.db.update(conversations).set({ leaseUntil: null }).where(eq(conversations.id, id));
  }

  /** Bump updated_at; set the title only if it is still empty. */
  async touch(id: string, titleCandidate: string) {
    await this.db
      .update(conversations)
      .set({
        updatedAt: sql`now()`,
        title: sql`coalesce(${conversations.title}, ${titleCandidate})`,
      })
      .where(eq(conversations.id, id));
  }
}