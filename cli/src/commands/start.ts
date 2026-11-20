import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CliError } from '../errors.js';
import { gatewayEntry } from '../gateway-files.js';

/**
 * Runs the assistant in this terminal (Ctrl+C stops it), with the same Node as `llm`.
 * Without --env-file it reads only real environment variables, so a stray .env in the
 * current folder never switches the mode by surprise.
 */
export async function startCommand(opts: { envFile?: string }): Promise<void> {
  const entry = gatewayEntry();
  if (!entry) {
    throw new CliError(
      "This copy of llm doesn't include the assistant.\n" +
        '  → Install the package (npm install -g local-llm-gateway), or run npm start in the gateway folder.',
    );
  }
  const args: string[] = [];
  if (opts.envFile) {
    const file = resolve(opts.envFile);
    if (!existsSync(file)) throw new CliError(`There is no file at ${file}.`);
    args.push(`--env-file=${file}`);
  }

  const child = spawn(process.execPath, [...args, entry], { stdio: 'inherit' });
  // Pass stop signals on and wait, so the gateway always shuts down cleanly (releases its
  // lock, closes the database). Ctrl+C in a terminal reaches both processes anyway; a
  // signal sent to `llm` alone (a process manager, `kill`) must still reach the gateway.
  const forward = (signal: NodeJS.Signals) => () => {
    if (child.exitCode === null) child.kill(signal);
  };
  const onInt = forward('SIGINT');
  const onTerm = forward('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  const code = await new Promise<number>((done) => {
    child.on('exit', (c, signal) => done(c ?? (signal ? 1 : 0)));
    child.on('error', () => done(1));
  });
  process.off('SIGINT', onInt);
  process.off('SIGTERM', onTerm);
  process.exitCode = code;
}
