// Finds the built web page (Vite's output, dist/web) from wherever the code runs:
// dist/src/... in the repo or the npm package, or src/... under tsx in development.
// Returns null when the page hasn't been built (the API still works without it).
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function findWebRoot(from = dirname(fileURLToPath(import.meta.url))): string | null {
  for (let dir = from; ; dir = dirname(dir)) {
    if (basename(dir) === 'dist' && existsSync(join(dir, 'web', 'index.html'))) return join(dir, 'web');
    if (existsSync(join(dir, 'dist', 'web', 'index.html'))) return join(dir, 'dist', 'web');
    if (dirname(dir) === dir) return null;
  }
}
