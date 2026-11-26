import { spawn } from 'node:child_process';
import { loadConfig } from '../config.js';
import { out } from '../format.js';
import { getClient } from './shared.js';

/** How to open a URL in the default browser on this system. */
export function browserCommand(url: string, platform: NodeJS.Platform = process.platform): [string, string[]] {
  if (platform === 'darwin') return ['open', [url]];
  if (platform === 'win32') return ['cmd', ['/c', 'start', '""', url]];
  return ['xdg-open', [url]];
}

/**
 * Opens the web chat, already signed in: asks the gateway (with this CLI's key) for a
 * one-time code and opens `<gateway>/#code=...`. The code sits after `#`, so it never
 * reaches a server log; the page exchanges it once for a session cookie.
 */
export async function openCommand(opts: { print?: boolean; show?: 'phone' }): Promise<void> {
  const { baseUrl } = loadConfig();
  const { code } = await getClient().webCode();
  // show=phone: the page opens "Phones & devices", which shows the pairing QR as an image.
  const url = `${baseUrl}/#code=${code}${opts.show ? `&show=${opts.show}` : ''}`;
  if (!opts.print) {
    const [cmd, args] = browserCommand(url);
    const opened = await new Promise<boolean>((done) => {
      const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
      child.on('error', () => done(false));
      child.on('spawn', () => {
        child.unref();
        done(true);
      });
    });
    if (opened) {
      console.log(opts.show === 'phone' ? 'Showing the QR code in your browser ("Phones & devices").' : `Opening the assistant in your browser: ${baseUrl}`);
      return;
    }
  }
  console.log('Open this link to sign in (it works once, within 60 seconds):');
  console.log(`  ${url}`);
  console.log(out.dim('Then the page stays signed in for 30 days of use. To sign in again later: llm open'));
}
