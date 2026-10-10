import { and, asc, count, desc, eq, gt } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { messages } from '../db/schema.js';

export type Message = typeof messages.$inferSelect;
export type MessageStatus = 'complete' | 'partial' | 'error';

export class MessagesRepo {
  constructor(private readonly db: Db) {}

  async add(v: {
    conversationId: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    status?: MessageStatus;
    model?: string | null;
  }) {
    const [row] = await this.db.insert(messages).values(v).returning();
    return row!;
  }

  /** Newest `limit` messages, returned in chronological order. */
  async listRecent(conversationId: string, limit: number): Promise<Message[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.seq))
      .limit(limit);
    return rows.reverse();
  }

  /**
   * One page of a transcript in chronological order, starting after `afterSeq`.
   * `hasMore` says whether more messages exist beyond this page, so a long
   * conversation is never silently cut off.
   */
  async listPage(
    conversationId: string,
    afterSeq = 0,
    limit = 500,
  ): Promise<{ rows: Message[]; hasMore: boolean }> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), gt(messages.seq, afterSeq)))
      .orderBy(asc(messages.seq))
      .limit(limit + 1);
    return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
  }

  async countAll(conversationId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(messages)
      .where(eq(messages.conversationId, conversationId));
    return row?.n ?? 0;
  }
}
