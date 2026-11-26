import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// An effect written as `useEffect(() => something(), deps)` returns what `something()`
// returns. React calls a returned value as the cleanup, so a non-function crashes the page.
// This happened: Chrome's scrollIntoView returns a Promise (Safari's returns nothing), so the
// chat broke on Android phones only. Effects must use a block body: `() => { ... }`.
describe('React effects', () => {
  it('never return a value by accident (block bodies only)', () => {
    const dir = import.meta.dirname;
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.tsx'))
      .flatMap((f) =>
        readFileSync(join(dir, f), 'utf8')
          .split('\n')
          .map((line, i) => ({ where: `${f}:${i + 1}`, line }))
          .filter(({ line }) => /use(Layout)?Effect\(\s*(async\s*)?\(\)\s*=>\s*[^{\s]/.test(line)),
      );
    expect(offenders).toEqual([]);
  });
});
