export class QueueFullError extends Error {
  constructor() {
    super('queue full');
  }
}

export class Semaphore {
  private active = 0;
  private waiters: Array<() => void> = [];

  constructor(
    private readonly max: number,
    private readonly maxQueue: number,
  ) {}

  get inFlight() { return this.active; }
  get queued() { return this.waiters.length; }

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return this.makeRelease();
    }
    if (this.waiters.length >= this.maxQueue) throw new QueueFullError();

    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        const i = this.waiters.indexOf(grant);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error('aborted while queued'));
      };
      const grant = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      this.waiters.push(grant);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    // slot was handed to us by release(); `active` was not decremented
    return this.makeRelease();
  }

  private makeRelease() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) next(); // hand the slot over directly
      else this.active--;
    };
  }
}