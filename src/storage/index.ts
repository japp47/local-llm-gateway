import type { config } from '../config.js';
import type { Storage } from './ports.js';
import { createPostgresStorage } from './postgres/index.js';

export type * from './ports.js';
export type * from './types.js';

/** The only place that decides which storage backend runs. */
export function createStorage(config: config): Storage {
  return createPostgresStorage(config.DATABASE_URL);
}
