import type { PhoneInfo } from './types';

/** Where a phone should go: Tailscale (HTTPS, anywhere) first, else the Wi-Fi address. Same rule as `llm phone`. */
export function phoneUrl(info: PhoneInfo): { url: string; via: 'tailscale' | 'wifi' } | null {
  if (info.tailscale.serving && info.tailscale.url) return { url: info.tailscale.url, via: 'tailscale' };
  if (info.wifi.listening && info.wifi.urls[0]) return { url: info.wifi.urls[0], via: 'wifi' };
  return null;
}

/** "4:59" for a countdown. */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
