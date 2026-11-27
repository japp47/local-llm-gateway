// Phone access helpers and the single-user network guard. Unit suite: no services.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createConfig, listenHost } from '../src/config.js';
import { isLocalRequest, lanAddresses, localName, networkHosts, requestHost, requestProtocol } from '../src/lib/network.js';
import type { OllamaInfo } from '../src/services/doctor.js';
import { deviceName } from '../src/services/web-session.service.js';
import { addUser, FakeProvider, FIXTURE_WEB_ROOT, PHONE_IP } from './helpers.js';

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

const iface = (address: string, internal = false, family: 'IPv4' | 'IPv6' = 'IPv4') =>
  ({ address, internal, family, netmask: '', mac: '', cidr: null }) as never;

describe('network helpers', () => {
  it('LAN addresses: IPv4 Wi-Fi/Ethernet only (no loopback, link-local, Tailscale or IPv6)', () => {
    const ifaces = {
      lo0: [iface('127.0.0.1', true)],
      en0: [iface('192.168.1.20'), iface('fe80::1', false, 'IPv6')],
      en5: [iface('169.254.10.2')],
      utun4: [iface('100.101.102.103')],
      en1: [iface('10.0.0.7'), iface('192.168.1.20')],
    };
    expect(lanAddresses(ifaces)).toEqual(['192.168.1.20', '10.0.0.7']);
  });

  it('the allow-list: addresses, the .local name, the Tailscale name and WEB_HOSTS, lower-cased', () => {
    expect(networkHosts({ addresses: ['192.168.1.20'], hostname: 'Japps-MacBook-Air', tailscaleName: 'mac.tail1234.ts.net', extra: ['Office-Box.lan'] }))
      .toEqual(['192.168.1.20', 'japps-macbook-air.local', 'mac.tail1234.ts.net', 'office-box.lan']);
    expect(localName('box.local')).toBe('box.local');
  });

  it('this computer vs the network', () => {
    const req = (remoteAddress: string, headers: Record<string, string>) => ({ socket: { remoteAddress }, headers });
    expect(isLocalRequest(req('127.0.0.1', { host: 'localhost:3000' }))).toBe(true);
    expect(isLocalRequest(req('::ffff:127.0.0.1', { host: '127.0.0.1:3000' }))).toBe(true);
    expect(isLocalRequest(req('::1', { host: '[::1]:3000' }))).toBe(true);
    expect(isLocalRequest(req(PHONE_IP, { host: `${PHONE_IP}:3000` }))).toBe(false); // Wi-Fi phone
    // The laptop reaching itself by its Wi-Fi address goes through the network side too.
    expect(isLocalRequest(req('127.0.0.1', { host: `${PHONE_IP}:3000` }))).toBe(false);
    // tailscale serve: from 127.0.0.1, but forwarded
    expect(isLocalRequest(req('127.0.0.1', { host: '127.0.0.1:3000', 'x-forwarded-for': '100.1.2.3' }))).toBe(false);
    expect(isLocalRequest(req('127.0.0.1', { host: 'localhost:3000', 'tailscale-user-login': 'me@x.com' }))).toBe(false);
  });

  it('forwarded host and protocol are trusted only from this computer', () => {
    const fwd = { host: '127.0.0.1:3000', 'x-forwarded-host': 'mac.tail1234.ts.net', 'x-forwarded-proto': 'https' };
    expect(requestHost({ socket: { remoteAddress: '127.0.0.1' }, headers: fwd })).toBe('mac.tail1234.ts.net');
    expect(requestProtocol({ socket: { remoteAddress: '127.0.0.1' }, headers: fwd }, 'http')).toBe('https');
    // The same headers from a phone on the Wi-Fi are ignored: it can't pretend to be HTTPS or another host.
    expect(requestHost({ socket: { remoteAddress: PHONE_IP }, headers: fwd })).toBe('127.0.0.1:3000');
    expect(requestProtocol({ socket: { remoteAddress: PHONE_IP }, headers: fwd }, 'http')).toBe('http');
  });

  it('listens on the network only in single-user mode with phone access on', () => {
    expect(listenHost(createConfig({ PHONE_ACCESS: 'wifi' }))).toBe('0.0.0.0');
    expect(listenHost(createConfig({}))).toBe('127.0.0.1');
    expect(listenHost(createConfig({ PHONE_ACCESS: 'wifi', HOST: '192.168.1.20' }))).toBe('192.168.1.20'); // explicit wins
    expect(listenHost(createConfig({ PHONE_ACCESS: 'wifi', DATABASE_URL: 'postgres://x@h/db' }))).toBe('127.0.0.1'); // server mode: HOST decides
  });

  it('device names from the browser', () => {
    expect(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('iPhone');
    expect(deviceName('Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari/537.36')).toBe('Android phone');
    expect(deviceName('Mozilla/5.0 (Linux; Android 15; SM-X710) Safari/537.36')).toBe('Android tablet');
    expect(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('Mac');
    expect(deviceName(undefined)).toBe('Browser');
  });
});

describe('single-user mode: what the network may reach', () => {
  async function single() {
    const root = mkdtempSync(join(tmpdir(), 'llmgw-net-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const config = createConfig({ DATA_DIR: join(root, 'data'), LOG_LEVEL: 'silent', ALLOWED_MODELS: 'fake-model', DEFAULT_MODEL: 'fake-model' });
    const ollama: OllamaInfo = { version: async () => 'x', installed: async () => [], loaded: async () => [] };
    const { app, deps } = await buildApp({ config, provider: new FakeProvider(), ollama, webRoot: FIXTURE_WEB_ROOT, networkHosts: [PHONE_IP] });
    cleanup.push(() => app.close());
    return { app, deps };
  }
  const fromPhone = (url: string, extra: Record<string, string> = {}) => ({
    method: 'GET' as const, url, remoteAddress: PHONE_IP, headers: { host: `${PHONE_IP}:3000`, ...extra },
  });

  it('the page, its files, sign-in and the API: yes', async () => {
    const { app, deps } = await single();
    expect((await app.inject(fromPhone('/'))).statusCode).toBe(200);
    expect((await app.inject(fromPhone('/assets/app.js'))).statusCode).toBe(200);
    expect((await app.inject(fromPhone('/healthz'))).statusCode).toBe(200);
    expect((await app.inject(fromPhone('/v1/me'))).statusCode).toBe(401); // reaches auth: needs a session
    const { headers } = await addUser(deps, 'me@local');
    expect((await app.inject(fromPhone('/v1/me', headers))).statusCode).toBe(200); // an API key works too
  });

  it('metrics, readiness and the API description: only on this computer', async () => {
    const { app } = await single();
    for (const url of ['/metrics', '/readyz', '/openapi.json']) {
      expect((await app.inject(fromPhone(url))).statusCode, url).toBe(404);
      expect((await app.inject({ method: 'GET', url })).statusCode, url).not.toBe(404);
    }
  });
});
