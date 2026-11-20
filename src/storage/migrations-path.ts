import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Finds `drizzle/<sub>` by walking up from this file, so migrations are found whether the
 * code runs from src/ (tsx) or dist/src/ (built), and from any working directory.
 */
export function migrationsFolder(sub: '' | 'sqlite'): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, 'drizzle', sub);
    if (existsSync(join(candidate, 'meta', '_journal.json'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`migrations folder drizzle/${sub} not found`);
    dir = parent;
  }
}

/** Number of migrations this build ships (entries in Drizzle's journal). */
export function availableMigrations(sub: '' | 'sqlite'): number {
  const journal = JSON.parse(readFileSync(join(migrationsFolder(sub), 'meta', '_journal.json'), 'utf8')) as {
    entries?: unknown[];
  };
  return journal.entries?.length ?? 0;
}
