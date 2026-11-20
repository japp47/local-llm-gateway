import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../config.js';
import { CliError } from '../errors.js';
import { out } from '../format.js';
import { gatewayMode } from '../key-diagnosis.js';
import { getClient } from './shared.js';

const size = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export async function backupCommand(opts: { json?: boolean }): Promise<void> {
  const b = await getClient().backup();
  if (opts.json) return void console.log(JSON.stringify(b, null, 2));
  console.log(`Saved a backup of ${b.conversations} conversations (${b.messages} messages, ${size(b.bytes)}):`);
  console.log(`  ${b.file}`);
  console.log(out.dim('It holds all your chats: keep it somewhere private. Restore with: llm restore <file>'));
}

/**
 * Restore swaps the database file, which only works while the assistant is stopped, so the
 * gateway's own tool does it. This command checks the file and gives the exact steps.
 */
export async function restoreCommand(file: string): Promise<void> {
  const path = resolve(file);
  if (!existsSync(path)) throw new CliError(`There is no file at ${path}.`);
  const running = (await gatewayMode(loadConfig().baseUrl)) !== undefined;
  const quoted = JSON.stringify(path);
  console.log('To restore this backup:');
  console.log(running ? '  1. Stop the assistant (Ctrl+C in its window).' : '  1. The assistant is already stopped. Good.');
  console.log(`  2. In the gateway folder, run:  npm run restore -- ${quoted}`);
  console.log(out.dim('     (with DATABASE_URL in your .env, run:  DATABASE_URL= npm run restore -- ' + quoted + ')'));
  console.log('  3. Start the assistant again:  npm start');
  console.log(out.dim('Your current chats are not deleted: they are moved to backups/before-restore-<time>.db first.'));
}
