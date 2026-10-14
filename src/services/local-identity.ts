// Zero-config identity for single-user mode: the gateway creates its own user and key on
// first start and hands the key to the CLI through a private file in the data folder.
// Auth stays on: a key is still required, so other programs or web pages on this machine
// cannot use the gateway just by reaching 127.0.0.1.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { config } from '../config.js';
import { writeFileAtomic } from '../lib/atomic-file.js';
import { generateApiKey, sha256 } from '../lib/hash.js';
import type { Storage } from '../storage/index.js';

export const LOCAL_EMAIL = 'local@localhost';
export const LOCAL_KEY_LABEL = 'local (auto)';

export interface LocalCredentials {
  baseUrl: string;
  apiKey: string;
}

export const localCredentialsPath = (config: config) => join(config.dataDir, 'local-credentials.json');

const LOOPBACK_OR_ANY = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0', '::']);

/** The URL a client on this machine uses. Matches the CLI's default (http://localhost:3000). */
export function localBaseUrl(config: config): string {
  const host = LOOPBACK_OR_ANY.has(config.HOST) ? 'localhost' : config.HOST;
  return `http://${host.includes(':') ? `[${host}]` : host}:${config.PORT}`;
}

function readSaved(path: string): LocalCredentials | null {
  try {
    const v = JSON.parse(readFileSync(path, 'utf8')) as Partial<LocalCredentials>;
    return typeof v.apiKey === 'string' && typeof v.baseUrl === 'string'
      ? { baseUrl: v.baseUrl, apiKey: v.apiKey }
      : null;
  } catch {
    return null; // missing or damaged: a new key is issued below
  }
}

/**
 * Makes sure the local user has a working key and that the credentials file holds it.
 * - File present and its key still active: keep it (only the URL is refreshed).
 * - Otherwise (first run, file lost or damaged, key revoked): revoke earlier auto keys
 *   and issue a new one. Only the key's hash is stored in the database, as always.
 * Runs after the instance lock is taken, so two gateways never race here.
 */
export async function ensureLocalIdentity(
  storage: Storage,
  config: config,
): Promise<{ path: string; created: boolean }> {
  const path = localCredentialsPath(config);
  const baseUrl = localBaseUrl(config);

  const saved = readSaved(path);
  if (saved && (await storage.apiKeys.findActiveByHash(sha256(saved.apiKey)))) {
    if (saved.baseUrl !== baseUrl) writeFileAtomic(path, JSON.stringify({ ...saved, baseUrl }, null, 2) + '\n');
    return { path, created: false };
  }

  const user = (await storage.users.findByEmail(LOCAL_EMAIL)) ?? (await storage.users.create(LOCAL_EMAIL));
  for (const key of await storage.apiKeys.listForUser(user.id)) {
    if (key.label === LOCAL_KEY_LABEL && !key.revokedAt) await storage.apiKeys.revoke(key.id);
  }
  const apiKey = generateApiKey();
  await storage.apiKeys.create(user.id, sha256(apiKey), LOCAL_KEY_LABEL);
  writeFileAtomic(path, JSON.stringify({ baseUrl, apiKey } satisfies LocalCredentials, null, 2) + '\n');
  return { path, created: true };
}
