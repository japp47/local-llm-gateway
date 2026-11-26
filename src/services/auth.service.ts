import { sha256 } from '../lib/hash.js';
import type { ApiKeysStore } from '../storage/index.js';

export interface AuthContext {
  userId: string;
  /** Rate-limit identity: the API key id, or `session:<id>` for a browser session. */
  keyId: string;
  /** How the caller proved who they are. Some actions need a key (e.g. making sign-in codes). */
  via?: 'key' | 'session';
  /** For a browser session: which one, and whether it was signed in on this computer or a paired device. */
  sessionId?: string;
  sessionFrom?: 'local' | 'network';
}

export class AuthService {
  constructor(private readonly keys: ApiKeysStore) {}

  /** Hash first, then look up by hash: no raw-key comparison happens in app code. */
  async authenticate(rawKey: string): Promise<AuthContext | null> {
    const row = await this.keys.findActiveByHash(sha256(rawKey));
    return row ? { userId: row.userId, keyId: row.id } : null;
  }
}