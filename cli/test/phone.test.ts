import { describe, expect, it } from 'vitest';
import type { PhoneInfo } from '../src/api.js';
import { howToEnable, phoneUrl } from '../src/commands/phone.js';
import { qrMatrix, terminalQr } from '../src/qr.js';

const info = (over: Partial<PhoneInfo> = {}): PhoneInfo => ({
  canPair: true,
  wifi: { listening: false, urls: [] },
  tailscale: { name: null, url: null, serving: false },
  ...over,
});

describe('llm phone', () => {
  it('prefers Tailscale (HTTPS, anywhere) over Wi-Fi', () => {
    const both = info({
      wifi: { listening: true, urls: ['http://192.168.1.20:3000'] },
      tailscale: { name: 'mac.tail.ts.net', url: 'https://mac.tail.ts.net', serving: true },
    });
    expect(phoneUrl(both)).toEqual({ url: 'https://mac.tail.ts.net', via: 'tailscale' });
  });

  it('uses the Wi-Fi address when Tailscale is not serving', () => {
    const wifi = info({
      wifi: { listening: true, urls: ['http://192.168.1.20:3000'] },
      tailscale: { name: 'mac.tail.ts.net', url: 'https://mac.tail.ts.net', serving: false },
    });
    expect(phoneUrl(wifi)).toEqual({ url: 'http://192.168.1.20:3000', via: 'wifi' });
  });

  it('nothing set up: explains both ways, naming the port and an installed Tailscale', () => {
    expect(phoneUrl(info())).toBeNull();
    const text = howToEnable(info({ tailscale: { name: 'mac.tail.ts.net', url: null, serving: false } }), 3000);
    expect(text).toContain('llm start --phone');
    expect(text).toContain('Tailscale is installed here (mac.tail.ts.net). Run:  tailscale serve --bg 3000');
    expect(howToEnable(info(), 3000)).toContain('Install Tailscale');
  });
});

describe('terminal QR code', () => {
  const link = 'http://192.168.1.20:3000/#code=0123456789abcdef0123456789abcdef';

  it('has the 4-module white border scanners need', () => {
    const m = qrMatrix(link);
    for (const i of [0, 1, 2, 3, m.length - 1, m.length - 4]) {
      expect(m[i]!.some(Boolean)).toBe(false); // a full light row
      expect(m.some((row) => row[i])).toBe(false); // a full light column
    }
    expect(m[4]![4]).toBe(true); // the finder pattern's corner starts right after it
  });

  // Parses the coloured output back into modules (true = dark) to check it round-trips.
  const sharpModules = (text: string) =>
    text.split('\n').map((line) => [...line.matchAll(/\x1b\[48;5;(\d+)m  /g)].map((c) => c[1] === '16'));
  const compactCells = (text: string) => [...text.matchAll(/\x1b\[38;5;(\d+)m\x1b\[48;5;(\d+)m▀/g)];

  it('sharp form: two coloured spaces per module (no font glyphs), when the window has room', () => {
    const qr = terminalQr(link, { columns: 120, rows: 60 });
    expect(qr.mode).toBe('sharp');
    expect(qr.text).not.toContain('▀');
    expect(sharpModules(qr.text)).toEqual(qrMatrix(link, 4));
    expect(new Set([...qr.text.matchAll(/\x1b\[48;5;(\d+)m/g)].map((c) => c[1]))).toEqual(new Set(['16', '231']));
  });

  it('sharp form with a 2-module border when 4 does not fit; compact when nothing fits', () => {
    const size4 = qrMatrix(link, 4).length;
    const narrow = terminalQr(link, { columns: size4 * 2 - 1, rows: 60 });
    expect(narrow.mode).toBe('sharp');
    expect(sharpModules(narrow.text)).toEqual(qrMatrix(link, 2));

    const small = terminalQr(link, { columns: 80, rows: 24 }); // macOS Terminal's default window
    expect(small.mode).toBe('compact');
    const m = qrMatrix(link, 4);
    const cells = compactCells(small.text);
    expect(cells).toHaveLength(m.length * Math.ceil(m.length / 2));
    cells.forEach((c, i) => {
      const x = i % m.length;
      const y = Math.floor(i / m.length) * 2;
      expect(c[1] === '16').toBe(m[y]![x]);
      expect(c[2] === '16').toBe(y + 1 < m.length ? m[y + 1]![x] : false);
    });
  });

  it('says how big the window must be for the sharp form', () => {
    const { needs } = terminalQr(link, { columns: 80, rows: 24 });
    expect(needs).toEqual({ columns: qrMatrix(link, 2).length * 2, rows: qrMatrix(link, 2).length + 5 });
    expect(terminalQr(link, needs).mode).toBe('sharp');
  });

  it('piped output (no window size) gets the sharp form', () => {
    expect(terminalQr(link).mode).toBe('sharp');
  });
});
