// This computer's addresses on the network, for phone access: which host names the page may
// be reached by, and which URLs to put in a pairing QR code. Detection is best effort; the
// gateway works the same without it (only localhost is allowed then).
import { execFile } from 'node:child_process';
import { networkInterfaces, hostname as osHostname } from 'node:os';
import type { IncomingHttpHeaders } from 'node:http';

type Interfaces = ReturnType<typeof networkInterfaces>;

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const isTailscaleIp = (ip: string) => {
  const [a, b] = ip.split('.').map(Number);
  return a === 100 && b! >= 64 && b! <= 127; // 100.64.0.0/10, the range Tailscale uses
};

/** IPv4 addresses on the local network (Wi-Fi, Ethernet): not loopback, link-local or Tailscale. */
export function lanAddresses(ifaces: Interfaces = networkInterfaces()): string[] {
  const out: string[] = [];
  for (const list of Object.values(ifaces)) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      if (i.address.startsWith('169.254.') || isTailscaleIp(i.address)) continue;
      out.push(i.address);
    }
  }
  return [...new Set(out)];
}

/** `macbook.local`: the name iPhones (and newer Androids) can use on the same Wi-Fi. */
export function localName(host: string = osHostname()): string {
  const base = host.toLowerCase().replace(/\.local$/, '');
  return `${base}.local`;
}

/** Every host name the page may be reached by, besides localhost. Pure: easy to test. */
export function networkHosts(input: { addresses: string[]; hostname: string; tailscaleName: string | null; extra: readonly string[] }): string[] {
  const names = [...input.addresses, localName(input.hostname), ...(input.tailscaleName ? [input.tailscaleName] : []), ...input.extra];
  return [...new Set(names.map((n) => n.toLowerCase()))];
}

const TAILSCALE_BINARIES = ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'];

function run(bin: string, args: string[], timeoutMs: number): Promise<string | null> {
  return new Promise((done) => {
    execFile(bin, args, { timeout: timeoutMs }, (err, stdout) => done(err ? null : stdout));
  });
}

/** This machine's Tailscale name (`mac.tailnet.ts.net`) and whether `tailscale serve` points at `port`. */
export async function detectTailscale(port: number, timeoutMs = 2000): Promise<{ name: string; serving: boolean } | null> {
  for (const bin of TAILSCALE_BINARIES) {
    const status = await run(bin, ['status', '--json'], timeoutMs);
    if (!status) continue;
    try {
      const name = String((JSON.parse(status) as { Self?: { DNSName?: string } }).Self?.DNSName ?? '').replace(/\.$/, '');
      if (!name) return null;
      const serve = (await run(bin, ['serve', 'status', '--json'], timeoutMs)) ?? '';
      const serving = serve.includes(`127.0.0.1:${port}`) || serve.includes(`localhost:${port}`);
      return { name: name.toLowerCase(), serving };
    } catch {
      return null;
    }
  }
  return null;
}

const LOOPBACK_ADDRESS = /^(127\.|::1$|::ffff:127\.)/;
export const isLoopbackAddress = (address: string | undefined) => !!address && LOOPBACK_ADDRESS.test(address);

interface RequestLike {
  socket: { remoteAddress?: string };
  headers: IncomingHttpHeaders;
}

const hostOnly = (host: string | undefined) => {
  const h = (host ?? '').trim().toLowerCase();
  return h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0]!;
};

/**
 * True only for a request from this computer itself. A phone behind `tailscale serve` also
 * connects from 127.0.0.1, but carries forwarding headers and a non-loopback host name, so
 * it counts as the network. (A local program that adds such headers only loses privileges.)
 */
export function isLocalRequest(req: RequestLike): boolean {
  const h = req.headers;
  return (
    isLoopbackAddress(req.socket.remoteAddress) &&
    !h['x-forwarded-for'] &&
    !h['x-forwarded-host'] &&
    !h['tailscale-user-login'] &&
    LOOPBACK_NAMES.has(hostOnly(h.host))
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim();

/** The host the browser used. Behind a local proxy (Tailscale), the forwarded one. */
export function requestHost(req: RequestLike): string | undefined {
  if (isLoopbackAddress(req.socket.remoteAddress)) return first(req.headers['x-forwarded-host']) ?? req.headers.host;
  return req.headers.host;
}

/** 'https' when the browser used HTTPS, including through a local proxy that ends TLS. */
export function requestProtocol(req: RequestLike, direct: string): string {
  if (isLoopbackAddress(req.socket.remoteAddress)) return first(req.headers['x-forwarded-proto']) ?? direct;
  return direct;
}

/**
 * The host names allowed right now. Network addresses can change (a new Wi-Fi), so the list
 * is rebuilt at most every 30 seconds; the Tailscale lookup runs in the background.
 */
export class WebHosts {
  private cached: { at: number; hosts: string[] } | null = null;
  private tailscale: { name: string; serving: boolean } | null = null;

  constructor(
    private readonly opts: { extra: readonly string[]; detect: boolean; port: number; fixed?: string[] },
  ) {
    if (opts.detect) void this.refreshTailscale();
  }

  list(): string[] {
    if (this.opts.fixed) return [...this.opts.fixed, ...this.opts.extra];
    if (!this.opts.detect) return [...this.opts.extra];
    const now = Date.now();
    if (!this.cached || now - this.cached.at > 30_000) {
      if (this.cached) void this.refreshTailscale();
      this.cached = {
        at: now,
        hosts: networkHosts({ addresses: lanAddresses(), hostname: osHostname(), tailscaleName: this.tailscale?.name ?? null, extra: this.opts.extra }),
      };
    }
    return this.cached.hosts;
  }

  tailscaleInfo() {
    return this.tailscale;
  }

  async refreshTailscale(): Promise<void> {
    this.tailscale = await detectTailscale(this.opts.port);
    this.cached = null;
  }
}
