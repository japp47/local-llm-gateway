// Browser sign-in for the web chat. The rules, in one place:
// - `llm open` (holding an API key) asks for a one-time code: random, 60 seconds, works once.
// - The page exchanges the code for a session token, sent back only as an HttpOnly cookie.
// - A session ends after 30 days without use; "last seen" is written at most once a minute.
// Codes and tokens are 256-bit random values; only their SHA-256 hashes are stored.
import { randomBytes } from 'node:crypto';
import { sha256 } from '../lib/hash.js';
import type { WebSessionsStore } from '../storage/index.js';

export const CODE_TTL_MS = 60_000;
export const SESSION_IDLE_MS = 30 * 24 * 3_600_000;
const TOUCH_EVERY_MS = 60_000;

const token = () => randomBytes(32).toString('base64url');

export interface WebAuthContext {
  userId: string;
  sessionId: string;
}

export class WebSessionService {
  constructor(
    private readonly store: WebSessionsStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createCode(userId: string): Promise<{ code: string; expiresAt: Date }> {
    const now = this.now();
    const code = token();
    const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
    await this.store.deleteExpired(new Date(now.getTime() - 24 * 3_600_000)); // cheap housekeeping
    await this.store.createCode(userId, sha256(code), expiresAt);
    return { code, expiresAt };
  }

  /** The raw session token to put in the cookie, or null if the code is unknown, used or expired. */
  async redeem(code: string): Promise<{ token: string; maxAgeSeconds: number } | null> {
    const now = this.now();
    const hit = await this.store.redeemCode(sha256(code), now);
    if (!hit) return null;
    const raw = token();
    await this.store.createSession(hit.userId, sha256(raw), now, new Date(now.getTime() + SESSION_IDLE_MS));
    return { token: raw, maxAgeSeconds: SESSION_IDLE_MS / 1000 };
  }

  async authenticate(rawToken: string): Promise<WebAuthContext | null> {
    const now = this.now();
    const s = await this.store.findActiveSession(sha256(rawToken), now);
    if (!s) return null;
    if (now.getTime() - s.lastSeenAt.getTime() >= TOUCH_EVERY_MS) {
      await this.store.touchSession(s.id, now, new Date(now.getTime() + SESSION_IDLE_MS));
    }
    return { userId: s.userId, sessionId: s.id };
  }

  signOut(rawToken: string): Promise<boolean> {
    return this.store.revokeSession(sha256(rawToken), this.now());
  }
}
