import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import type { GenerationsStore } from '../ports.js';
import type { Generation, ModelStatsRow, NewGeneration, RecentGeneration } from '../types.js';
import { generations } from './schema.js';

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export class PgGenerationsStore implements GenerationsStore {
  constructor(private readonly db: Db) {}

  async add(v: NewGeneration): Promise<Generation> {
    const [row] = await this.db.insert(generations).values(v).returning();
    return row!;
  }

  async statsByModel(userId: string, since: Date): Promise<ModelStatsRow[]> {
    const rows = await this.db.execute(sql`
      select
        model,
        provider,
        count(*)::int                                          as requests,
        (count(*) filter (where status = 'complete'))::int     as complete,
        (count(*) filter (where status = 'partial'))::int      as partial,
        (count(*) filter (where status = 'error'))::int        as errors,
        coalesce(sum(prompt_tokens), 0)::float8                as prompt_tokens,
        coalesce(sum(completion_tokens), 0)::float8            as completion_tokens,
        round(avg(ttft_ms))::int                               as avg_ttft_ms,
        round((percentile_cont(0.5)  within group (order by ttft_ms))::numeric)::int as p50_ttft_ms,
        round((percentile_cont(0.95) within group (order by ttft_ms))::numeric)::int as p95_ttft_ms,
        round(avg(queue_wait_ms))::int                         as avg_queue_ms,
        round((avg(completion_tokens::numeric / (generation_ms / 1000.0))
               filter (where generation_ms > 0 and completion_tokens > 0))::numeric, 1)::float8 as avg_tok_per_sec
      from generations
      where user_id = ${userId} and created_at >= ${since.toISOString()}::timestamptz
      group by model, provider
      order by requests desc, model asc
    `);

    return (rows as unknown as Record<string, unknown>[]).map((r) => ({
      model: r.model as string,
      provider: r.provider as string,
      requests: Number(r.requests),
      complete: Number(r.complete),
      partial: Number(r.partial),
      errors: Number(r.errors),
      promptTokens: Number(r.prompt_tokens),
      completionTokens: Number(r.completion_tokens),
      avgTtftMs: num(r.avg_ttft_ms),
      p50TtftMs: num(r.p50_ttft_ms),
      p95TtftMs: num(r.p95_ttft_ms),
      avgQueueMs: num(r.avg_queue_ms),
      avgTokPerSec: num(r.avg_tok_per_sec),
    }));
  }

  async recent(userId: string, limit: number, since?: Date): Promise<RecentGeneration[]> {
    if (limit === 0) return [];
    return this.db
      .select({
        requestId: generations.requestId,
        conversationId: generations.conversationId,
        provider: generations.provider,
        model: generations.model,
        status: generations.status,
        errorCode: generations.errorCode,
        promptTokens: generations.promptTokens,
        completionTokens: generations.completionTokens,
        queueWaitMs: generations.queueWaitMs,
        ttftMs: generations.ttftMs,
        generationMs: generations.generationMs,
        createdAt: generations.createdAt,
      })
      .from(generations)
      .where(
        since
          ? and(eq(generations.userId, userId), gte(generations.createdAt, since))
          : eq(generations.userId, userId),
      )
      .orderBy(desc(generations.createdAt))
      .limit(limit);
  }

  async listByUser(userId: string): Promise<Generation[]> {
    return this.db
      .select()
      .from(generations)
      .where(eq(generations.userId, userId))
      .orderBy(asc(generations.createdAt));
  }
}
