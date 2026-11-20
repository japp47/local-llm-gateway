import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../config.js';
import { CliError } from '../errors.js';
import { out } from '../format.js';
import { restoreEntry, startHint } from '../gateway-files.js';
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
 * Restore swaps the database file, which only works while the assistant is stopped. When the
 * gateway is installed next to this CLI (the npm package, or the repo after a build), its own
 * restore tool runs right here: it checks the file, refuses while the assistant runs, and
 * moves the current database aside. Otherwise this prints the steps.
 */
export async function restoreCommand(file: string): Promise<void> {
  const path = resolve(file);
  if (!existsSync(path)) throw new CliError(`There is no file at ${path}.`);

  const tool = restoreEntry();
  if (tool) {
    // Single-user restore: DATABASE_URL from the user's shell must not switch it to Postgres.
    const env = { ...process.env, DATABASE_URL: '' };
    const code = await new Promise<number>((done) => {
      const child = spawn(process.execPath, [tool, path], { stdio: 'inherit', env });
      child.on('exit', (c) => done(c ?? 1));
      child.on('error', () => done(1));
    });
    process.exitCode = code;
    return;
  }

  const running = (await gatewayMode(loadConfig().baseUrl)) !== undefined;
  const quoted = JSON.stringify(path);
  console.log('To restore this backup:');
  console.log(running ? '  1. Stop the assistant (Ctrl+C in its window).' : '  1. The assistant is already stopped. Good.');
  console.log(`  2. In the gateway folder, run:  DATABASE_URL= npm run restore -- ${quoted}`);
  console.log(`  3. Start the assistant again:  ${startHint()}`);
  console.log(out.dim('Your current chats are not deleted: they are moved to backups/before-restore-<time>.db first.'));
}
