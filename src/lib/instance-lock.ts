import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';

/** Startup was refused for a reason the user can fix; the message says how. */
export class StartupError extends Error {}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 only checks that the process exists
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'; // exists, owned by someone else
  }
}

function readOwner(path: string): { pid: number } | null {
  try {
    const owner = JSON.parse(readFileSync(path, 'utf8')) as { pid?: unknown };
    return typeof owner.pid === 'number' ? { pid: owner.pid } : null;
  } catch {
    return null; // missing, or half-written by a crashed process
  }
}

/**
 * One gateway per data folder, like Postgres's postmaster.pid: the lock file holds the
 * owner's PID. A live owner means another gateway is running; a dead one means it crashed,
 * so the lock is taken over. Returns a function that releases the lock.
 */
export function acquireInstanceLock(path: string, info: Record<string, unknown> = {}): () => void {
  for (let attempt = 0; attempt < 2; attempt++) {
    let fd: number;
    try {
      fd = openSync(path, 'wx', 0o600); // fails if the file exists: atomic "create if absent"
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const owner = readOwner(path);
      if (owner && owner.pid !== process.pid && isAlive(owner.pid)) {
        throw new StartupError(
          `Another gateway is already using this data folder (process ${owner.pid}). ` +
            `Stop it first, or set DATA_DIR to use a different folder. Lock file: ${path}`,
        );
      }
      unlinkSync(path); // stale: its owner is gone
      continue;
    }
    writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), ...info }));
    closeSync(fd);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (readOwner(path)?.pid === process.pid) unlinkSync(path);
    };
  }
  throw new StartupError(`Could not take the lock file ${path}. Delete it if no gateway is running.`);
}
