// Finds the key a single-user gateway on this machine leaves for the CLI, so `llm chat`
// works with no key setup. The key is only ever sent to that same local gateway.
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

type Env = Record<string, string | undefined>;

export interface LocalCredentials {
  baseUrl: string;
  apiKey: string;
}

/** The gateway's single-user data folder. Must match `defaultDataDir` in the gateway. */
export function gatewayDataDir(
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
): string {
  if (env.DATA_DIR) return env.DATA_DIR;
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'llm-gateway');
  if (platform === 'win32') return join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'llm-gateway');
  return join(env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'llm-gateway');
}

export const localCredentialsPath = (env: Env = process.env) =>
  join(gatewayDataDir(env), 'local-credentials.json');

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * True when both URLs reach the gateway on this machine: same scheme and port, and both
 * hosts are loopback names (localhost, 127.0.0.1 and ::1 are the same machine).
 */
export function sameLocalGateway(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    const port = (u: URL) => u.port || (u.protocol === 'https:' ? '443' : '80');
    return (
      ua.protocol === ub.protocol &&
      port(ua) === port(ub) &&
      LOOPBACK.has(ua.hostname.toLowerCase()) &&
      LOOPBACK.has(ub.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

export type LocalCredentialsResult =
  | { kind: 'found'; credentials: LocalCredentials }
  | { kind: 'none' }
  | { kind: 'ignored'; reason: string };

/**
 * Reads the credentials file. It is ignored (with a reason) unless it belongs to this
 * user and nobody else can read it: a key others can read is not a secret.
 */
export function readLocalCredentials(path: string): LocalCredentialsResult {
  let mode: number;
  let uid: number;
  try {
    ({ mode, uid } = statSync(path));
  } catch {
    return { kind: 'none' };
  }
  if (process.platform !== 'win32') {
    if (typeof process.getuid === 'function' && uid !== process.getuid()) {
      return { kind: 'ignored', reason: `${path} belongs to another user, so its key was not used.` };
    }
    if (mode & 0o077) {
      return {
        kind: 'ignored',
        reason: `${path} can be read by other users, so its key was not used. Fix with: chmod 600 "${path}"`,
      };
    }
  }
  try {
    const v = JSON.parse(readFileSync(path, 'utf8')) as Partial<LocalCredentials>;
    if (typeof v.baseUrl === 'string' && typeof v.apiKey === 'string' && v.apiKey) {
      return { kind: 'found', credentials: { baseUrl: v.baseUrl, apiKey: v.apiKey } };
    }
  } catch {
    // damaged: the gateway replaces it on its next start
  }
  return { kind: 'none' };
}
