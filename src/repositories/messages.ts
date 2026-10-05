import { asc, desc, eq } from 'drizzle-orm';
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

  async listAll(conversationId: string, limit = 500): Promise<Message[]> {
    return this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.seq))
      .limit(limit);
  }
}