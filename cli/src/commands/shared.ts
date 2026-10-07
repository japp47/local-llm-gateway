import { ApiClient } from '../api.js';
import { loadConfig } from '../config.js';
import { CliError } from '../errors.js';

export function getClient(): ApiClient {
  const cfg = loadConfig();

  if (cfg.profileProblem) throw new CliError(cfg.profileProblem);

  if (cfg.keyWithheldFor) {
    throw new CliError(
      `LLM_BASE_URL (${cfg.keyWithheldFor}) is a different gateway from the one in your saved profile, ` +
        'so the saved API key was not sent there.\n' +
        'Set LLM_API_KEY for that gateway as well, or unset LLM_BASE_URL.',
    );
  }

  if (!cfg.apiKey) {
    throw new CliError(
      'No API key configured. Create one on the gateway (npm run key:create -- you@example.com),\n' +
        'then run: llm profile add <name>   (you will be asked for the key)',
    );
  }
  return new ApiClient({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey });
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}
