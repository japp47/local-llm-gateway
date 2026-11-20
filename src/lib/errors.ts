export interface AppErrorOptions {
  headers?: Record<string, string>;
  /** What the person can do about it, in plain words. Optional, so older clients ignore it. */
  hint?: string;
}

export class AppError extends Error {
  readonly headers: Record<string, string>;
  readonly hint?: string;

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    opts: AppErrorOptions = {},
  ) {
    super(message);
    this.headers = opts.headers ?? {};
    this.hint = opts.hint;
  }
}
