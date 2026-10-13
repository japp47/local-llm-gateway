import { and, asc, count, desc, eq, gt } from 'drizzle-orm';
import type { MessagesStore } from '../ports.js';
import type { Message, NewMessage } from '../types.js';
import type { SqliteDb } from './client.js';
import { messages } from './schema.js';

export class SqliteMessagesStore implements MessagesStore {
  constructor(private readonly db: SqliteDb) {}

  async add(v: NewMessage): Promise<Message> {
    return this.db.insert(messages).values(v).returning().get();
  }

  async listRecent(conversationId: string, limit: number): Promise<Message[]> {
    const rows = this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.seq))
      .limit(limit)
      .all();
    return rows.reverse();
  }

  async listPage(
    conversationId: string,
    afterSeq = 0,
    limit = 500,
  ): Promise<{ rows: Message[]; hasMore: boolean }> {
    const rows = this.db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), gt(messages.seq, afterSeq)))
      .orderBy(asc(messages.seq))
      .limit(limit + 1)
      .all();
    return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
  }

  async countAll(conversationId: string): Promise<number> {
    const row = this.db
      .select({ n: count() })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .get();
    return row?.n ?? 0;
  }
}
