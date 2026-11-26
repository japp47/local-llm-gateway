import { describe, expect, it } from 'vitest';
import { mmss, phoneUrl } from './phone';
import type { PhoneInfo } from './types';

const base: PhoneInfo = { canPair: true, wifi: { listening: false, urls: [] }, tailscale: { name: null, url: null, serving: false } };

describe('phone pairing on the page', () => {
  it('Tailscale first, then Wi-Fi, else nothing', () => {
    expect(phoneUrl(base)).toBeNull();
    const wifi = { ...base, wifi: { listening: true, urls: ['http://192.168.1.20:3000'] } };
    expect(phoneUrl(wifi)).toEqual({ url: 'http://192.168.1.20:3000', via: 'wifi' });
    const both = { ...wifi, tailscale: { name: 'mac.t.ts.net', url: 'https://mac.t.ts.net', serving: true } };
    expect(phoneUrl(both)?.via).toBe('tailscale');
  });

  it('countdown text', () => {
    expect(mmss(300_000)).toBe('5:00');
    expect(mmss(61_001)).toBe('1:02');
    expect(mmss(-5)).toBe('0:00');
  });
});
