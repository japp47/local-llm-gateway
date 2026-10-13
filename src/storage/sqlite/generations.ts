import { and, asc, desc, eq, gte } from 'drizzle-orm';
import { mean, percentileCont } from '../../lib/stats.js';
import type { GenerationsStore } from '../ports.js';
import type { Generation, ModelStatsRow, NewGeneration, RecentGeneration } from '../types.js';
import type { SqliteDb } from './client.js';
import { generations } from './schema.js';

type StatsInput = Pick<
  Generation,
  'model' | 'provider' | 'status' | 'promptTokens' | 'completionTokens' | 'ttftMs' | 'queueWaitMs' | 'generationMs'
>;

const nonNull = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null);
const roundOrNull = (x: number | null) => (x === null ? null : Math.round(x));
const sum = (xs: (number | null)[]) => nonNull(xs).reduce((a, b) => a + b, 0);

/** Same numbers as the Postgres query in storage/postgres/generations.ts, computed in code. */
export function aggregateByModel(rows: StatsInput[]): ModelStatsRow[] {
  const groups = new Map<string, StatsInput[]>();
  for (const r of rows) {
    const key = JSON.stringify([r.model, r.provider]);
    const group = groups.get(key);
    if (group) group.push(r);
    else groups.set(key, [r]);
  }

  const out: ModelStatsRow[] = [];
  for (const g of groups.values()) {
    const ttfts = nonNull(g.map((r) => r.ttftMs)).sort((a, b) => a - b);
    const rates = g
      .filter((r) => (r.generationMs ?? 0) > 0 && (r.completionTokens ?? 0) > 0)
      .map((r) => r.completionTokens! / (r.generationMs! / 1000));
    const avgRate = mean(rates);
    out.push({
      model: g[0]!.model,
      provider: g[0]!.provider,
      requests: g.length,
      complete: g.filter((r) => r.status === 'complete').length,
      partial: g.filter((r) => r.status === 'partial').length,
      errors: g.filter((r) => r.status === 'error').length,
      promptTokens: sum(g.map((r) => r.promptTokens)),
      completionTokens: sum(g.map((r) => r.completionTokens)),
      avgTtftMs: roundOrNull(mean(ttfts)),
      p50TtftMs: roundOrNull(percentileCont(ttfts, 0.5)),
      p95TtftMs: roundOrNull(percentileCont(ttfts, 0.95)),
      avgQueueMs: roundOrNull(mean(nonNull(g.map((r) => r.queueWaitMs)))),
      avgTokPerSec: avgRate === null ? null : Math.round(avgRate * 10) / 10,
    });
  }
  return out.sort((a, b) => b.requests - a.requests || a.model.localeCompare(b.model));
}

export class SqliteGenerationsStore implements GenerationsStore {
  constructor(private readonly db: SqliteDb) {}

  async add(v: NewGeneration): Promise<Generation> {
    return this.db.insert(generations).values(v).returning().get();
  }

  /**
   * Loads the window's rows and aggregates in code (SQLite has no percentile_cont).
   * O(rows in the window): fine for one person's history; server mode keeps it in SQL.
   */
  async statsByModel(userId: string, since: Date): Promise<ModelStatsRow[]> {
    const rows = this.db
      .select({
        model: generations.model,
        provider: generations.provider,
        status: generations.status,
        promptTokens: generations.promptTokens,
        completionTokens: generations.completionTokens,
        ttftMs: generations.ttftMs,
        queueWaitMs: generations.queueWaitMs,
        generationMs: generations.generationMs,
      })
      .from(generations)
      .where(and(eq(generations.userId, userId), gte(generations.createdAt, since)))
      .all();
    return aggregateByModel(rows);
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
      .limit(limit)
      .all();
  }

  async listByUser(userId: string): Promise<Generation[]> {
    return this.db
      .select()
      .from(generations)
      .where(eq(generations.userId, userId))
      .orderBy(asc(generations.createdAt))
      .all();
  }
}
