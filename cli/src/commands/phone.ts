import type { PhoneInfo } from '../api.js';
import { terminalQr } from '../qr.js';
import { openCommand } from './open.js';
import { loadConfig } from '../config.js';
import { CliError } from '../errors.js';
import { out, relativeTime, shortId } from '../format.js';
import { getClient } from './shared.js';

/** Where a phone should go: Tailscale (HTTPS, anywhere) first, else the Wi-Fi address. */
export function phoneUrl(info: PhoneInfo): { url: string; via: 'tailscale' | 'wifi' } | null {
  if (info.tailscale.serving && info.tailscale.url) return { url: info.tailscale.url, via: 'tailscale' };
  if (info.wifi.listening && info.wifi.urls[0]) return { url: info.wifi.urls[0], via: 'wifi' };
  return null;
}

/** What to do when no phone can reach the assistant yet. */
export function howToEnable(info: PhoneInfo, port: number): string {
  const tailscale = info.tailscale.name
    ? `Tailscale is installed here (${info.tailscale.name}). Run:  tailscale serve --bg ${port}`
    : 'Install Tailscale on this computer and your phone (tailscale.com), sign in to both, then run:  tailscale serve --bg ' + port;
  return [
    "Phones can't reach the assistant yet. Choose one:",
    '',
    '  Same Wi-Fi (at home; the connection is not encrypted):',
    '    stop the assistant (Ctrl+C), then start it with:  llm start --phone',
    '',
    '  Anywhere, encrypted (Tailscale):',
    `    ${tailscale}`,
    '',
    'Then run llm phone again.',
  ].join('\n');
}

export async function phoneCommand(opts: { print?: boolean; browser?: boolean }): Promise<void> {
  const client = getClient();
  const info = await client.phoneInfo();
  if (!info.canPair) {
    throw new CliError("Phones can only be connected from the computer running the assistant.");
  }
  const target = phoneUrl(info);
  if (!target) throw new CliError(howToEnable(info, Number(new URL(loadConfig().baseUrl).port || 80)));

  // The page's "Phones & devices" makes its own pairing code and shows the QR as an image.
  if (opts.browser) return openCommand({ show: 'phone' });

  const { code } = await client.webCode('pair');
  const link = `${target.url}/#code=${code}`;
  if (opts.print) return void console.log(link);

  const qr = terminalQr(link, { columns: process.stdout.columns, rows: process.stdout.rows });
  console.log(qr.text);
  console.log("Scan this with your phone's camera. It works once, for 5 minutes.");
  if (qr.mode === 'compact') {
    // Some terminals (macOS Terminal with many fonts) leave thin gaps between lines here,
    // which phones can't read. The sharp form has no such gaps but needs a bigger window.
    const now = `${process.stdout.columns}x${process.stdout.rows}`;
    console.log(out.yellow(`This window is small (${now}), so the code may not scan. Either:`));
    console.log(out.yellow(`  make the window at least ${qr.needs.columns}x${qr.needs.rows} (or shrink the text with Cmd -) and run llm phone again,`));
    console.log(out.yellow('  or show it in your browser: llm phone --browser'));
  } else {
    console.log(out.dim("Won't scan? Show it in your browser: llm phone --browser"));
  }
  console.log(out.dim(`  ${target.url}  (${target.via === 'tailscale' ? 'Tailscale, encrypted, works anywhere' : 'same Wi-Fi only, not encrypted'})`));
  console.log(out.dim('See or remove connected phones: llm devices'));
}

export async function devicesCommand(): Promise<void> {
  const { data } = await getClient().devices();
  if (data.length === 0) return void console.log(out.dim('No signed-in browsers or phones. Connect a phone with: llm phone'));
  for (const d of data) {
    const where = d.createdFrom === 'local' ? 'this computer' : 'paired device';
    console.log(`${shortId(d.id)}  ${(d.deviceName ?? 'Browser').padEnd(14)} ${where.padEnd(14)} ${out.dim(`last used ${relativeTime(d.lastSeenAt)}`)}`);
  }
  console.log(out.dim('\nRemove one (it is signed out at once): llm devices revoke <id>'));
}

export async function revokeDeviceCommand(idOrPrefix: string): Promise<void> {
  const client = getClient();
  const { data } = await client.devices();
  const hits = data.filter((d) => d.id.startsWith(idOrPrefix));
  if (hits.length === 0) throw new CliError(`No signed-in device starts with "${idOrPrefix}". See: llm devices`);
  if (hits.length > 1) throw new CliError(`"${idOrPrefix}" matches ${hits.length} devices; use more characters.`);
  await client.revokeDevice(hits[0]!.id);
  console.log(`Removed ${hits[0]!.deviceName ?? 'the device'} (${shortId(hits[0]!.id)}). It is signed out.`);
}
