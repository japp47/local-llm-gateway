import { randomBytes } from 'node:crypto';
import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Writes a file atomically, owner-only: a temp file in the same folder (created 0600) is
 * flushed, then renamed over the target. A crash leaves the old file or the new one,
 * never half of one. Same pattern as the CLI's config file.
 */
export function writeFileAtomic(path: string, data: string): void {
  const tmp = join(dirname(path), `.${randomBytes(6).toString('hex')}.tmp`);
  try {
    const fd = openSync(tmp, 'wx', 0o600);
    try {
      writeSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // temp file already gone
    }
    throw err;
  }
}
