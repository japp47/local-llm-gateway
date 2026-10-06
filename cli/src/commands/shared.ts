import { ApiClient } from '../api.js';
import { loadConfig } from '../config.js';
import { CliError } from '../errors.js';

export function getClient(): ApiClient {
  const cfg = loadConfig();
  if (!cfg.apiKey) {
    throw new CliError(
      'No API key configured. Create one on the gateway (npm run key:create -- you@example.com),\n' +
        'then run: llm config set apiKey <key>',
    );
  }
  return new ApiClient({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey });
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}