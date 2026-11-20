// Explains a rejected API key in terms of what is actually running.
//
// The usual cause on one machine: single-user mode (npm run dev:single, SQLite) and server
// mode (npm run dev, Postgres) both listen on localhost:3000 but have separate databases, so
// a key made for one is unknown to the other. We ask the gateway which mode it runs in, and
// try the other keys saved for this same URL to name the profile that works.
//
// Safety rule kept: a saved key is only ever sent to the URL it was saved for.
import { ApiError } from './api.js';
import type { CliConfig, CliProfile } from './config.js';
import { listProfiles, loadConfig, sameGateway } from './config.js';
import { describeError } from './errors.js';
import {
  localCredentialsPath,
  readLocalCredentials,
  type LocalCredentialsResult,
  sameLocalGateway,
} from './local-credentials.js';

export type GatewayMode = 'single' | 'server';

export interface DiagnosisInput {
  config: CliConfig;
  profiles: { name: string; profile: CliProfile }[];
  local: LocalCredentialsResult;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const MODE_LABEL: Record<GatewayMode, string> = {
  single: 'the single-user gateway (npm run dev:single, SQLite)',
  server: 'the server-mode gateway (npm run dev, Postgres)',
};

/** Older gateways don't report a mode; that is fine, the advice is just less specific. */
export async function gatewayMode(baseUrl: string, fetchImpl: typeof fetch = fetch, timeoutMs = 2000): Promise<GatewayMode | undefined> {
  try {
    const res = await fetchImpl(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(timeoutMs) });
    const body = (await res.json()) as { mode?: unknown };
    return body.mode === 'single' || body.mode === 'server' ? body.mode : undefined;
  } catch {
    return undefined;
  }
}

async function keyWorks(baseUrl: string, key: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetchImpl(`${baseUrl}/v1/me`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function describeSource(c: CliConfig): string {
  if (c.overrides?.includes('apiKey')) return 'The key in LLM_API_KEY';
  if (c.keySource === 'local-gateway') return "The single-user gateway's own key";
  if (c.currentProfile) return `The key in profile "${c.currentProfile}"`;
  return 'The saved key';
}

/** describeError, plus a diagnosis when the error is a rejected key. */
export async function describeErrorFully(e: unknown): Promise<string> {
  if (e instanceof ApiError && e.code === 'invalid_api_key') {
    try {
      return await explainRejectedKey({
        config: loadConfig(),
        profiles: listProfiles(),
        local: readLocalCredentials(localCredentialsPath()),
      });
    } catch {
      // the diagnosis is a bonus; fall back to the plain message
    }
  }
  return describeError(e);
}

/** A plain explanation and the next command to run. */
export async function explainRejectedKey(input: DiagnosisInput): Promise<string> {
  const { config: c, fetchImpl = fetch, timeoutMs = 2000 } = input;
  const mode = await gatewayMode(c.baseUrl, fetchImpl, timeoutMs);
  const where = mode ? `${MODE_LABEL[mode]} at ${c.baseUrl}` : `the gateway at ${c.baseUrl}`;
  const lines = [`${describeSource(c)} isn't accepted by ${where}.`];

  // Other keys saved for this same URL (never for another one): which of them work here?
  const others = input.profiles.filter(
    (p) => p.name !== c.currentProfile && p.profile.apiKey && sameGateway(p.profile.baseUrl, c.baseUrl),
  );
  const working: string[] = [];
  const results = await Promise.all(others.map((p) => keyWorks(c.baseUrl, p.profile.apiKey!, fetchImpl, timeoutMs)));
  results.forEach((ok, i) => ok && working.push(others[i]!.name));

  const localKey =
    input.local.kind === 'found' && sameLocalGateway(c.baseUrl, input.local.credentials.baseUrl) ? input.local.credentials.apiKey : undefined;
  const localWorks = localKey !== undefined && localKey !== c.apiKey && (await keyWorks(c.baseUrl, localKey, fetchImpl, timeoutMs));

  if (working.length > 0) {
    lines.push(`→ Switch to a profile that works with it: llm profile use ${working[0]}`);
    if (working.length > 1) lines.push(`  (these work too: ${working.slice(1).join(', ')})`);
  } else if (localWorks) {
    const localProfile = input.profiles.find((p) => !p.profile.apiKey && sameGateway(p.profile.baseUrl, c.baseUrl));
    lines.push(
      localProfile
        ? `→ Use the gateway's own key: llm profile use ${localProfile.name}`
        : "→ Use the gateway's own key: llm profile add local --local  then  llm profile use local",
    );
  } else if (mode === 'single') {
    lines.push('→ This key is probably for server mode. Start that instead: npm run dev');
  } else if (mode === 'server') {
    lines.push(
      '→ If you meant the single-user gateway, start it instead: npm run dev:single',
      '  Otherwise make a key on the server: npm run key:create -- you@example.com  then  llm config set apiKey',
    );
  } else {
    lines.push('→ Save a valid key with: llm config set apiKey  (you will be prompted)');
  }
  if (mode) lines.push('  Why: both modes use the same address but separate databases, so their keys differ.');
  return lines.join('\n');
}
