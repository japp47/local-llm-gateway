import { listProfiles, loadConfig } from '../config.js';
import { runDoctor, type CheckStatus } from '../doctor.js';
import { out } from '../format.js';
import { gatewayDataDir, localCredentialsPath, readLocalCredentials } from '../local-credentials.js';

const ICON: Record<CheckStatus, (s: string) => string> = {
  ok: (s) => out.green(s),
  warn: (s) => out.yellow(s),
  fail: (s) => out.red(s),
};
const MARK: Record<CheckStatus, string> = { ok: '✓', warn: '!', fail: '✗' };

export async function doctorCommand(opts: { json?: boolean }): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    // A broken config file is itself a finding, not a crash.
    config = { baseUrl: 'http://localhost:3000', profileProblem: (e as Error).message };
  }
  const checks = await runDoctor({
    config,
    profiles: (() => {
      try {
        return listProfiles();
      } catch {
        return [];
      }
    })(),
    local: readLocalCredentials(localCredentialsPath()),
    dataDir: gatewayDataDir(),
    ollamaUrl: (process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434').replace(/\/+$/, ''),
  });
  const failed = checks.filter((c) => c.status === 'fail').length;
  process.exitCode = failed > 0 ? 1 : 0;

  if (opts.json) {
    console.log(JSON.stringify({ ok: failed === 0, checks }, null, 2));
    return;
  }
  for (const c of checks) {
    console.log(`${ICON[c.status](MARK[c.status])} ${c.message}`);
    if (c.hint) console.log(out.dim(`  → ${c.hint}`));
  }
  const warned = checks.filter((c) => c.status === 'warn').length;
  console.log(
    failed > 0
      ? out.red(`\n${failed} problem${failed > 1 ? 's' : ''} found.`)
      : warned > 0
        ? out.yellow(`\nWorking, with ${warned} warning${warned > 1 ? 's' : ''}.`)
        : out.green('\nAll good.'),
  );
}
