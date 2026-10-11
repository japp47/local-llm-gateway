import { sha256 } from '../lib/hash.js';
import type { ApiKeysStore } from '../storage/index.js';

export interface AuthContext {
  userId: string;
  keyId: string;
}

export class AuthService {
  constructor(private readonly keys: ApiKeysStore) {}

  /** Hash first, then look up by hash: no raw-key comparison happens in app code. */
  async authenticate(rawKey: string): Promise<AuthContext | null> {
    const row = await this.keys.findActiveByHash(sha256(rawKey));
    return row ? { userId: row.userId, keyId: row.id } : null;
  }
}