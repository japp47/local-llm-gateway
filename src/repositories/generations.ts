import type { Db } from '../db/client.js';
import { generations } from '../db/schema.js';

export type NewGeneration = typeof generations.$inferInsert;

export class GenerationsRepo {
  constructor(private readonly db: Db) {}

  async add(v: NewGeneration) {
    const [row] = await this.db.insert(generations).values(v).returning();
    return row!;
  }
}