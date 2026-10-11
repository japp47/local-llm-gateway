import { and, asc, count, desc, eq, gt } from 'drizzle-orm';
import type { Db } from './client.js';
import type { MessagesStore } from '../ports.js';
import type { Message, NewMessage } from '../types.js';
import { messages } from './schema.js';

export class PgMessagesStore implements MessagesStore {
  constructor(private readonly db: Db) {}

  async add(v: NewMessage): Promise<Message> {
    const [row] = await this.db.insert(messages).values(v).returning();
    return row!;
  }

  async listRecent(conversationId: string, limit: number): Promise<Message[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.seq))
      .limit(limit);
    return rows.reverse();
  }

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
