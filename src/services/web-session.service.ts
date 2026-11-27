// Browser sign-in for the web chat and paired phones. The rules, in one place:
// - `llm open` (holding an API key) asks for an 'open' code: 60 seconds, works once, and
//   only on this computer itself, so a leaked link is useless from anywhere else.
// - `llm phone` or the laptop's page asks for a 'pair' code: 5 minutes (scanning takes
//   time), works once, from the phone.
// - The page exchanges the code for a session token, sent back only as an HttpOnly cookie.
//   The session remembers the device ("iPhone") and where it was created (local/network).
// - A session ends after 30 days without use; "last seen" is written at most once a minute.
// Codes and tokens are 256-bit random values; only their SHA-256 hashes are stored.
import { randomBytes } from 'node:crypto';
import { sha256 } from '../lib/hash.js';
import type { CodePurpose, SessionOrigin, WebSessionInfo, WebSessionsStore } from '../storage/index.js';

export const CODE_TTL_MS: Record<CodePurpose, number> = { open: 60_000, pair: 5 * 60_000 };
export const SESSION_IDLE_MS = 30 * 24 * 3_600_000;
const TOUCH_EVERY_MS = 60_000;

const token = () => randomBytes(32).toString('base64url');

export interface WebAuthContext {
  userId: string;
  sessionId: string;
  createdFrom: SessionOrigin;
}

export type RedeemResult =
  | { kind: 'ok'; token: string; maxAgeSeconds: number }
  | { kind: 'invalid' } // unknown, used or expired
  | { kind: 'local_only' }; // an `llm open` code used from another device

/** A readable name for the devices list, from the browser's User-Agent. */
export function deviceName(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Android phone' : 'Android tablet';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Linux|CrOS/i.test(ua)) return 'Linux computer';
  return 'Browser';
}

export class WebSessionService {
  constructor(
    private readonly store: WebSessionsStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createCode(userId: string, purpose: CodePurpose = 'open'): Promise<{ code: string; expiresAt: Date }> {
    const now = this.now();
    const code = token();
    const expiresAt = new Date(now.getTime() + CODE_TTL_MS[purpose]);
    await this.store.deleteExpired(new Date(now.getTime() - 24 * 3_600_000)); // cheap housekeeping
    await this.store.createCode(userId, sha256(code), expiresAt, purpose);
    return { code, expiresAt };
  }

  /**
   * Exchanges a code for a session. An 'open' code is consumed even when refused from the
   * network, so a leaked link can't be retried from this computer by someone else either.
   */
  async redeem(code: string, from: { local: boolean; userAgent?: string }): Promise<RedeemResult> {
    const now = this.now();
    const hit = await this.store.redeemCode(sha256(code), now);
    if (!hit) return { kind: 'invalid' };
    if (hit.purpose === 'open' && !from.local) return { kind: 'local_only' };
    const raw = token();
    await this.store.createSession(hit.userId, sha256(raw), now, new Date(now.getTime() + SESSION_IDLE_MS), {
      name: deviceName(from.userAgent),
      createdFrom: from.local ? 'local' : 'network',
    });
    return { kind: 'ok', token: raw, maxAgeSeconds: SESSION_IDLE_MS / 1000 };
  }

  async authenticate(rawToken: string): Promise<WebAuthContext | null> {
    const now = this.now();
    const s = await this.store.findActiveSession(sha256(rawToken), now);
    if (!s) return null;
    if (now.getTime() - s.lastSeenAt.getTime() >= TOUCH_EVERY_MS) {
      await this.store.touchSession(s.id, now, new Date(now.getTime() + SESSION_IDLE_MS));
    }
    return { userId: s.userId, sessionId: s.id, createdFrom: s.createdFrom };
  }

  signOut(rawToken: string): Promise<boolean> {
    return this.store.revokeSession(sha256(rawToken), this.now());
  }

  devices(userId: string): Promise<WebSessionInfo[]> {
    return this.store.listSessions(userId, this.now());
  }

  revokeDevice(userId: string, sessionId: string): Promise<boolean> {
    return this.store.revokeSessionById(userId, sessionId, this.now());
  }
}
