import { describe, it, expect } from 'vitest';
import { Semaphore, QueueFullError } from '../src/lib/semaphore.js';

describe('Semaphore', () => {
  it('limits concurrency, queues, and rejects when full', async () => {
    const s = new Semaphore(1, 1);
    const r1 = await s.acquire();
    const p2 = s.acquire();
    expect(s.queued).toBe(1);
    await expect(s.acquire()).rejects.toBeInstanceOf(QueueFullError);
    r1();
    const r2 = await p2;
    expect(s.inFlight).toBe(1);
    r2();
    expect(s.inFlight).toBe(0);
  });

  it('removes aborted waiters from the queue', async () => {
    const s = new Semaphore(1, 5);
    const r1 = await s.acquire();
    const ac = new AbortController();
    const p = s.acquire(ac.signal);
    ac.abort();
    await expect(p).rejects.toThrow();
    expect(s.queued).toBe(0);
    r1();
  });
});