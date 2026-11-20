// `llm doctor`: one command that says what is wrong and what to do. Works even when the
// gateway is down: then the CLI checks Ollama and the gateway's data folder itself. When
// the gateway answers, it adds the gateway's own checks (GET /v1/doctor), which are the
// same ones the gateway logs at startup.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CliConfig, CliProfile } from './config.js';
import { startHint } from './gateway-files.js';
import { explainRejectedKey, type GatewayMode } from './key-diagnosis.js';
import type { LocalCredentialsResult } from './local-credentials.js';

export type CheckStatus = 'ok' | 'warn' | 'fail';
export interface Check {
  id: string;
  status: CheckStatus;
  message: string;
  hint?: string;
}

export interface DoctorInput {
  config: CliConfig;
  profiles: { name: string; profile: CliProfile }[];
  local: LocalCredentialsResult;
  /** The single-user gateway's data folder on this machine. */
  dataDir: string;
  ollamaUrl: string;
  fetchImpl?: typeof fetch;
  isAlive?: (pid: number) => boolean;
  timeoutMs?: number;
}

const MODE_LABEL: Record<GatewayMode, string> = { single: 'single-user mode', server: 'server mode' };

function isLoopback(url: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 only checks that the process exists
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function configCheck(c: CliConfig): Check {
  const id = 'config';
  if (c.profileProblem) return { id, status: 'fail', message: c.profileProblem };
  if (c.keyWithheldFor) {
    return {
      id,
      status: 'fail',
      message: `LLM_BASE_URL (${c.keyWithheldFor}) is a different gateway from your saved profile, so the saved key isn't sent there.`,
      hint: 'Set LLM_API_KEY for that gateway too, or unset LLM_BASE_URL.',
    };
  }
  if (!c.apiKey) {
    if (c.localKeyIgnored) return { id, status: 'fail', message: c.localKeyIgnored };
    return {
      id,
      status: 'fail',
      message: 'No API key is set up.',
      hint: `Start the assistant on this computer once (${startHint()}); the CLI then finds its key by itself. For a shared gateway: llm profile add <name>`,
    };
  }
  const source = c.overrides?.includes('apiKey')
    ? 'LLM_API_KEY'
    : c.keySource === 'local-gateway'
      ? "the single-user gateway's own key"
      : c.currentProfile
        ? `profile "${c.currentProfile}"`
        : 'your saved settings';
  return { id, status: 'ok', message: `Using ${c.baseUrl}, key from ${source}.` };
}

type Probe =
  | { kind: 'ours'; mode?: GatewayMode }
  | { kind: 'other' } // something answers, but not our gateway
  | { kind: 'down' };

async function probeGateway(baseUrl: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<Probe> {
  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return { kind: 'down' };
  }
  try {
    const body = (await res.json()) as { ok?: unknown; mode?: unknown };
    if (res.ok && body.ok === true) {
      return { kind: 'ours', mode: body.mode === 'single' || body.mode === 'server' ? body.mode : undefined };
    }
  } catch {
    // not JSON: not our gateway
  }
  return { kind: 'other' };
}

/** What the single-user gateway's lock file says about a gateway that doesn't answer. */
function lockNote(dataDir: string, baseUrl: string, alive: (pid: number) => boolean): string {
  let lock: { pid?: unknown; port?: unknown };
  try {
    lock = JSON.parse(readFileSync(join(dataDir, 'gateway.lock'), 'utf8'));
  } catch {
    return '';
  }
  if (typeof lock.pid !== 'number') return '';
  if (!alive(lock.pid)) return ' It seems to have stopped without shutting down cleanly; it recovers by itself on the next start.';
  const port = typeof lock.port === 'number' ? lock.port : undefined;
  const wanted = Number(new URL(baseUrl).port || 80);
  if (port && port !== wanted) {
    return ` A single-user gateway is running on port ${port} instead. Use it with: LLM_BASE_URL=http://localhost:${port} llm chat`;
  }
  return ` A single-user gateway process (PID ${lock.pid}) is running but not answering; restart it.`;
}

async function directOllamaCheck(ollamaUrl: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<Check[]> {
  try {
    const v = (await (await fetchImpl(`${ollamaUrl}/api/version`, { signal: AbortSignal.timeout(timeoutMs) })).json()) as { version?: string };
    const tags = (await (await fetchImpl(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) })).json()) as {
      models?: { name: string }[];
    };
    const chat = (tags.models ?? []).filter((m) => !/embed/i.test(m.name));
    return [
      { id: 'ollama', status: 'ok', message: v.version ? `Ollama ${v.version} is running.` : 'Ollama is running.' },
      chat.length > 0
        ? { id: 'model', status: 'ok', message: `${chat.length} chat model${chat.length > 1 ? 's' : ''} downloaded (${chat.map((m) => m.name).join(', ')}).` }
        : { id: 'model', status: 'fail', message: 'No chat model is downloaded yet.', hint: 'Run: ollama pull llama3.2:3b  (start the assistant to see which model fits this computer best)' },
    ];
  } catch {
    return [{ id: 'ollama', status: 'fail', message: "Ollama isn't running.", hint: 'Open the Ollama app (or run: ollama serve), then try again.' }];
  }
}

export async function runDoctor(input: DoctorInput): Promise<Check[]> {
  const { config: c, fetchImpl = fetch, timeoutMs = 3000, isAlive = pidAlive } = input;
  const checks: Check[] = [configCheck(c)];
  const local = isLoopback(c.baseUrl);

  const probe = await probeGateway(c.baseUrl, fetchImpl, timeoutMs);
  if (probe.kind === 'other') {
    checks.push({
      id: 'gateway',
      status: 'fail',
      message: `Another program is answering at ${c.baseUrl}, not the assistant.`,
      hint: `Stop that program, or start the assistant on a free port (PORT=3001 ${startHint()}) and point the CLI there.`,
    });
  } else if (probe.kind === 'down') {
    const note = local ? lockNote(input.dataDir, c.baseUrl, isAlive) : '';
    checks.push({
      id: 'gateway',
      status: 'fail',
      message: `The assistant isn't running at ${c.baseUrl}.${note}`,
      hint: local ? `Start it with: ${startHint()}` : 'Ask whoever runs that gateway to start it.',
    });
    // The gateway can't check Ollama for us, so check it from here (same machine only).
    if (local) checks.push(...(await directOllamaCheck(input.ollamaUrl, fetchImpl, timeoutMs)));
    return checks;
  } else {
    checks.push({
      id: 'gateway',
      status: 'ok',
      message: `The assistant is running at ${c.baseUrl}${probe.mode ? ` (${MODE_LABEL[probe.mode]})` : ''}.`,
    });
  }
  if (probe.kind !== 'ours' || !c.apiKey || checks[0]!.status === 'fail') return checks;

  // Is the key accepted? If not, explain exactly why (wrong mode, which profile works).
  const me = await fetchImpl(`${c.baseUrl}/v1/me`, {
    headers: { authorization: `Bearer ${c.apiKey}` },
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => null);
  if (!me?.ok) {
    if (me?.status === 401) {
      const [message, ...rest] = (await explainRejectedKey({ ...input, fetchImpl, timeoutMs })).split('\n');
      checks.push({ id: 'key', status: 'fail', message: message!, hint: rest.map((l) => l.trim().replace(/^→ /, '')).join(' ') });
    } else {
      checks.push({ id: 'key', status: 'fail', message: `The gateway couldn't check your key (HTTP ${me?.status ?? 'no answer'}).` });
    }
    return checks;
  }
  const user = (await me.json()) as { email?: string };
  checks.push({ id: 'key', status: 'ok', message: `Your key works${user.email ? ` (signed in as ${user.email})` : ''}.` });

  // The gateway's own checks: Ollama and models as the gateway sees them, and its database.
  const res = await fetchImpl(`${c.baseUrl}/v1/doctor`, {
    headers: { authorization: `Bearer ${c.apiKey}` },
    signal: AbortSignal.timeout(timeoutMs * 3), // it talks to Ollama and the database itself
  }).catch(() => null);
  if (res?.status === 404) {
    checks.push({ id: 'gateway-checks', status: 'warn', message: 'This gateway is an older version without full checks.', hint: 'Update the assistant.' });
  } else if (!res?.ok) {
    checks.push({ id: 'gateway-checks', status: 'fail', message: `The gateway's own checks didn't run (HTTP ${res?.status ?? 'no answer'}).` });
  } else {
    checks.push(...((await res.json()) as { checks: Check[] }).checks);
  }
  return checks;
}
