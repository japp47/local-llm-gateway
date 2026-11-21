// Checks that keep other websites from using the gateway through the user's browser.
//
// The gateway listens on localhost, and any page the user visits can send requests there.
// A cookie session must not let them in:
// - Host check: a browser on a DNS-rebinding page sends that page's domain as `Host`, so a
//   cookie request (or a sign-in) must be addressed to a loopback name or a configured host.
// - Origin check: a cookie request that changes something must come from the gateway's own
//   page (`Origin` equal to the gateway). SameSite=Strict already stops cross-site cookies;
//   this is the second lock.
// API keys in `Authorization` are not affected: another site can't know the key.
export const SESSION_COOKIE = 'llmgw_session';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
export const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The host part of a Host header, lower-cased, without the port ("[::1]:3000" -> "[::1]"). */
export function hostName(host: string | undefined): string {
  if (!host) return '';
  const h = host.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.split(':')[0]!;
}

export function allowedHost(host: string | undefined, extra: readonly string[]): boolean {
  const name = hostName(host);
  return LOOPBACK.has(name) || extra.map((e) => e.toLowerCase()).includes(name);
}

/** True when `origin` is exactly this gateway (same scheme-agnostic host and port as `Host`). */
export function sameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin || !host || origin === 'null') return false;
  try {
    return new URL(origin).host.toLowerCase() === host.trim().toLowerCase();
  } catch {
    return false;
  }
}
