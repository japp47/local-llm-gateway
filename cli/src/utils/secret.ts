import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

/** Reads all of stdin and trims surrounding whitespace (used for `--api-key-stdin`). */
export async function readSecretFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8').trim();
}

/**
 * Asks for a secret on the terminal without echoing it. Returns undefined when
 * there is no terminal to ask on (piped input), so the caller can explain the
 * non-interactive options instead of hanging.
 */
export async function promptSecret(question: string): Promise<string | undefined> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) return undefined;

  process.stderr.write(question);

  const silent = new Writable({ write: (_chunk, _enc, done) => done() });
  const rl = createInterface({ input: process.stdin, output: silent, terminal: true });

  return new Promise<string | undefined>((resolve) => {
    let answered = false;
    rl.question('', (answer) => {
      answered = true;
      process.stderr.write('\n');
      rl.close();
      resolve(answer.trim());
    });
    rl.on('close', () => {
      if (!answered) {
        process.stderr.write('\n');
        resolve(undefined); // Ctrl-C / Ctrl-D
      }
    });
  });
}
