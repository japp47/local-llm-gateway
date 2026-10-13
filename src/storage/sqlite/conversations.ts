import { and, asc, desc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { ConversationsStore } from '../ports.js';
import type {
  Conversation,
  ConversationListKey,
  ForkInput,
  ForkResult,
  NewConversation,
} from '../types.js';
import type { SqliteDb } from './client.js';
import { conversations, messages } from './schema.js';

// Rows per INSERT when copying history: stays far below SQLite's bound-parameter limit.
const COPY_CHUNK = 500;

export class SqliteConversationsStore implements ConversationsStore {
  constructor(private readonly db: SqliteDb) {}

  async create(v: NewConversation): Promise<Conversation> {
    const now = new Date();
    return this.db
      .insert(conversations)
      .values({ ...v, createdAt: now, updatedAt: now })
      .returning()
      .get();
  }

  /**
   * BEGIN IMMEDIATE takes the write lock up front, so nothing can change the source
   * while it is copied (Postgres uses FOR SHARE row locks for this). better-sqlite3
   * transactions are synchronous: nothing inside may await.
   */
  async fork(v: ForkInput): Promise<ForkResult> {
    return this.db.transaction(
      (tx): ForkResult => {
        const source = tx
          .select()
          .from(conversations)
          .where(
            and(eq(conversations.id, v.sourceConversationId), eq(conversations.userId, v.userId)),
          )
          .get();
        if (!source) return { kind: 'conversation_not_found' };

        const anchor = tx
          .select({ id: messages.id, seq: messages.seq })
          .from(messages)
          .where(
            and(
              eq(messages.id, v.fromMessageId),
              eq(messages.conversationId, source.id),
              inArray(messages.role, ['user', 'assistant']),
            ),
          )
          .get();
        if (!anchor) return { kind: 'message_not_found' };

        const now = new Date();
        const fork = tx
          .insert(conversations)
          .values({
            userId: v.userId,
            title: v.title ?? `${source.title ?? 'Conversation'} (branch)`.slice(0, 200),
            defaultModel: v.defaultModel ?? source.defaultModel,
            systemPrompt: source.systemPrompt,
            parentConversationId: source.id,
            forkedFromMessageId: anchor.id,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();

        const history = tx
          .select({
            role: messages.role,
            content: messages.content,
            status: messages.status,
            model: messages.model,
            createdAt: messages.createdAt,
          })
          .from(messages)
          .where(and(eq(messages.conversationId, source.id), lte(messages.seq, anchor.seq)))
          .orderBy(asc(messages.seq))
          .all();

        // Inserted in order, so the copies get increasing seq values.
        for (let i = 0; i < history.length; i += COPY_CHUNK) {
          tx.insert(messages)
            .values(history.slice(i, i + COPY_CHUNK).map((m) => ({ ...m, conversationId: fork.id })))
            .run();
        }

        return { kind: 'forked', conversation: fork, messageCount: history.length };
      },
      { behavior: 'immediate' },
    );
  }

  async get(userId: string, id: string): Promise<Conversation | null> {
    return (
      this.db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
        .get() ?? null
    );
  }

  async list(userId: string, limit: number, after?: ConversationListKey): Promise<Conversation[]> {
    // Keyset paging on (updated_at, id): the id breaks ties so equal timestamps are never skipped.
    const older = after
      ? or(
          lt(conversations.updatedAt, after.updatedAt),
          and(eq(conversations.updatedAt, after.updatedAt), lt(conversations.id, after.id)),
        )
      : undefined;
    return this.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.userId, userId), older))
      .orderBy(desc(conversations.updatedAt), desc(conversations.id))
      .limit(limit)
      .all();
  }

  async rename(userId: string, id: string, title: string): Promise<Conversation | null> {
    return (
      this.db
        .update(conversations)
        .set({ title, updatedAt: new Date() })
        .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
        .returning()
        .get() ?? null
    );
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const rows = this.db
      .delete(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
      .returning({ id: conversations.id })
      .all();
    return rows.length > 0;
  }

  /**
   * One UPDATE is an atomic compare-and-set: SQLite runs one writer at a time. Uses the
   * app clock, which is safe because single-user mode runs on one machine (Postgres uses
   * the database clock because server-mode gateways may run on several machines).
   */
  async acquireLease(id: string, seconds: number): Promise<boolean> {
    const now = Date.now();
    const rows = this.db
      .update(conversations)
      .set({ leaseUntil: new Date(now + seconds * 1000) })
      .where(
        and(
          eq(conversations.id, id),
          or(isNull(conversations.leaseUntil), lt(conversations.leaseUntil, new Date(now))),
        ),
      )
      .returning({ id: conversations.id })
      .all();
    return rows.length > 0;
  }

  async releaseLease(id: string): Promise<void> {
    this.db.update(conversations).set({ leaseUntil: null }).where(eq(conversations.id, id)).run();
  }

  async touch(id: string, titleCandidate: string): Promise<void> {
    this.db
      .update(conversations)
      .set({
        updatedAt: new Date(),
        title: sql`coalesce(${conversations.title}, ${titleCandidate})`,
      })
      .where(eq(conversations.id, id))
      .run();
  }
}
