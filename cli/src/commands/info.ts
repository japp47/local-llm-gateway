import { type ConfigKey, configPath, loadConfig, maskKey, saveConfigValue } from '../config.js';
import { CliError } from '../errors.js';
import { out, relativeTime, renderTable, shortId } from '../format.js';
import { CONFIG_KEYS } from '../utils/constants.js';
import { resolveApiKeyInput } from './profile.js';
import { getClient } from './shared.js';

export async function modelsCommand(opts: { json?: boolean }): Promise<void> {
  const { data } = await getClient().models();
  if (opts.json) return void console.log(JSON.stringify(data, null, 2));
  for (const m of data) console.log(`${m.default ? '*' : ' '} ${m.id}${m.default ? out.dim('  (server default)') : ''}`);
}

const num = (v: number | null, suffix = '') => (v === null ? '-' : `${v}${suffix}`);

export async function statsCommand(opts: { hours: string; recent: string; json?: boolean }): Promise<void> {
  const hours = Number(opts.hours);
  const recent = Number(opts.recent);
  if (!Number.isInteger(hours) || hours < 1 || hours > 720) throw new CliError('--hours must be between 1 and 720');
  if (!Number.isInteger(recent) || recent < 0 || recent > 50) throw new CliError('--recent must be between 0 and 50');

  const s = await getClient().stats(hours, recent);
  if (opts.json) return void console.log(JSON.stringify(s, null, 2));
  if (s.models.length === 0) return void console.log(out.dim(`No generations in the last ${hours}h.`));

  console.log(out.bold(`Last ${hours}h`));
  const [head, ...rows] = renderTable(
    ['MODEL', 'REQS', 'OK/PART/ERR', 'TOKENS IN/OUT', 'TTFT p50/p95', 'TOK/S', 'QUEUE'],
    s.models.map((m) => [
      m.model,
      String(m.requests),
      `${m.complete}/${m.partial}/${m.errors}`,
      `${m.promptTokens}/${m.completionTokens}`,
      `${num(m.p50TtftMs)}/${num(m.p95TtftMs, 'ms')}`,
      num(m.avgTokPerSec),
      num(m.avgQueueMs, 'ms'),
    ]),
  );
  console.log(out.dim(head!));
  console.log(rows.join('\n'));

  if (s.recent.length > 0) {
    console.log('\n' + out.bold('Recent'));
    const [h2, ...r2] = renderTable(
      ['WHEN', 'MODEL', 'STATUS', 'TTFT', 'OUT', 'CONV'],
      s.recent.map((g) => [
        relativeTime(g.createdAt),
        g.model,
        g.errorCode ? `${g.status} (${g.errorCode})` : g.status,
        num(g.ttftMs, 'ms'),
        num(g.completionTokens),
        g.conversationId ? shortId(g.conversationId) : '-',
      ]),
    );
    console.log(out.dim(h2!));
    console.log(r2.join('\n'));
  }
}

export async function configSetCommand(
  key: string,
  value: string | undefined,
  opts: { apiKeyStdin?: boolean } = {},
): Promise<void> {
  if (!(CONFIG_KEYS as readonly string[]).includes(key)) {
    throw new CliError(`Unknown key "${key}". Valid keys: ${CONFIG_KEYS.join(', ')}`);
  }

  let finalValue = value;
  if (key === 'apiKey') {
    // Leave the value off to be prompted (or use --api-key-stdin) so the key stays out of shell history.
    finalValue = await resolveApiKeyInput({ apiKey: value, apiKeyStdin: opts.apiKeyStdin });
  } else if (finalValue === undefined) {
    throw new CliError(`Usage: llm config set ${key} <value>`);
  }

  saveConfigValue(key as ConfigKey, finalValue);
  console.log(`${key} saved to ${configPath()}`);
}

export function configShowCommand(): void {
  const c = loadConfig();
  const from = (k: ConfigKey, name: string) => (c.overrides?.includes(k) ? out.dim(`  (from ${name})`) : '');
  console.log(`profile  ${c.currentProfile ?? '(none)'}`);
  console.log(`baseUrl  ${c.baseUrl}${from('baseUrl', 'LLM_BASE_URL')}`);
  console.log(`apiKey   ${maskKey(c.apiKey)}${from('apiKey', 'LLM_API_KEY')}`);
  console.log(`model    ${c.model ?? '(server default)'}${from('model', 'LLM_MODEL')}`);
  console.log(out.dim(`file     ${configPath()}  (env LLM_BASE_URL / LLM_API_KEY / LLM_MODEL override it)`));
  if (c.keyWithheldFor) console.log(out.dim('note     the saved key is not used because LLM_BASE_URL points to a different gateway'));
  if (c.profileProblem) console.log(out.dim(`note     ${c.profileProblem}`));
}

export function configPathCommand(): void {
  console.log(configPath());
}