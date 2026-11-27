// Phone access: pairing by one-time code, the devices list, and who may do what. On both
// storage backends. "From the network" is simulated with inject's remoteAddress (Wi-Fi) or
// with the headers `tailscale serve` adds when it forwards a phone's request to 127.0.0.1.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeProvider, makeTestApp, PHONE_IP, TAILSCALE_NAME } from './helpers.js';

type T = Awaited<ReturnType<typeof makeTestApp>>;
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15';

/** A request from the laptop's own browser. */
const laptop = { host: 'localhost:3000', origin: 'http://localhost:3000', 'user-agent': MAC };
/** A phone on the same Wi-Fi. */
const wifiPhone = { remoteAddress: PHONE_IP, headers: { host: `${PHONE_IP}:3000`, origin: `http://${PHONE_IP}:3000`, 'user-agent': IPHONE } };
/** A phone through `tailscale serve` (it connects from 127.0.0.1 and forwards these). */
const tailscalePhone = {
  remoteAddress: '127.0.0.1',
  headers: {
    host: '127.0.0.1:3000',
    'x-forwarded-host': TAILSCALE_NAME,
    'x-forwarded-proto': 'https',
    'x-forwarded-for': '100.101.102.103',
    origin: `https://${TAILSCALE_NAME}`,
    'user-agent': IPHONE,
  },
};

describe('phone access', () => {
  let t: T;
  let key: Record<string, string>;

  beforeEach(async () => {
    t = await makeTestApp(new FakeProvider());
    key = (await t.addUser('phone@example.com')).headers;
  });
  afterEach(async () => {
    await t.close();
  });

  const code = async (purpose: 'open' | 'pair', headers: Record<string, string> = key) => {
    const res = await t.app.inject({ method: 'POST', url: '/v1/web/codes', headers, payload: { purpose } });
    return res;
  };
  const redeem = (c: string, from: { remoteAddress: string; headers: Record<string, string> }) =>
    t.app.inject({ method: 'POST', url: '/web/session', remoteAddress: from.remoteAddress, headers: from.headers, payload: { code: c } });
  const cookieOf = (res: Awaited<ReturnType<typeof redeem>>) => res.cookies.find((c) => c.name === 'llmgw_session')!;
  const as = (token: string, from: { remoteAddress: string; headers: Record<string, string> }) => ({
    remoteAddress: from.remoteAddress,
    headers: { ...from.headers, cookie: `llmgw_session=${token}` },
  });
  /** Sign the laptop's browser in (llm open), from this computer. */
  const laptopSession = async () => {
    const c = (await code('open')).json().code;
    return cookieOf(await redeem(c, { remoteAddress: '127.0.0.1', headers: laptop })).value;
  };

  it('a pairing code signs a phone in over Wi-Fi; it shows up as an iPhone from the network', async () => {
    const res = await code('pair');
    expect(res.statusCode).toBe(201);
    expect(new Date(res.json().expiresAt).getTime() - Date.now()).toBeGreaterThan(4 * 60_000); // 5 minutes
    const signedIn = await redeem(res.json().code, wifiPhone);
    expect(signedIn.statusCode).toBe(204);
    const token = cookieOf(signedIn).value;

    const me = await t.app.inject({ method: 'GET', url: '/v1/me', ...as(token, wifiPhone) });
    expect(me.json()).toMatchObject({ email: 'phone@example.com' });

    const devices = await t.app.inject({ method: 'GET', url: '/v1/web/sessions', ...as(token, wifiPhone) });
    expect(devices.json().data).toEqual([expect.objectContaining({ deviceName: 'iPhone', createdFrom: 'network', current: true })]);
  });

  it('an llm open link is useless from a phone, and is used up by trying', async () => {
    const c = (await code('open')).json().code;
    const res = await redeem(c, wifiPhone);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatchObject({ code: 'open_link_local_only', hint: 'To connect a phone, use the QR code from llm phone.' });
    expect((await redeem(c, { remoteAddress: '127.0.0.1', headers: laptop })).statusCode).toBe(401); // gone
  });

  it('a phone cannot pair more phones or make sign-in links', async () => {
    const token = cookieOf(await redeem((await code('pair')).json().code, wifiPhone)).value;
    const pair = await t.app.inject({ method: 'POST', url: '/v1/web/codes', ...as(token, wifiPhone), payload: { purpose: 'pair' } });
    expect(pair.statusCode).toBe(403);
    expect(pair.json().error.code).toBe('pair_from_computer');
    const open = await t.app.inject({ method: 'POST', url: '/v1/web/codes', ...as(token, wifiPhone), payload: { purpose: 'open' } });
    expect(open.json().error.code).toBe('key_required');
  });

  it("the laptop's browser can pair a phone, but only while it is on the laptop", async () => {
    const token = await laptopSession();
    const local = await t.app.inject({ method: 'POST', url: '/v1/web/codes', remoteAddress: '127.0.0.1', headers: { ...laptop, cookie: `llmgw_session=${token}` }, payload: { purpose: 'pair' } });
    expect(local.statusCode).toBe(201);
    // The same cookie, copied to another device on the Wi-Fi: not "this computer" any more.
    const copied = await t.app.inject({ method: 'POST', url: '/v1/web/codes', ...as(token, wifiPhone), payload: { purpose: 'pair' } });
    expect(copied.json().error.code).toBe('pair_from_computer');
  });

  it('removing a phone signs it out; a phone may remove only itself', async () => {
    const laptopToken = await laptopSession();
    const phoneToken = cookieOf(await redeem((await code('pair')).json().code, wifiPhone)).value;
    const list = (await t.app.inject({ method: 'GET', url: '/v1/web/sessions', headers: key })).json().data as Array<{ id: string; createdFrom: string; current: boolean }>;
    expect(list.map((d) => d.createdFrom).sort()).toEqual(['local', 'network']);
    expect(list.every((d) => !d.current)).toBe(true); // an API key is no device
    const phoneId = list.find((d) => d.createdFrom === 'network')!.id;
    const laptopId = list.find((d) => d.createdFrom === 'local')!.id;

    const phoneRemovesLaptop = await t.app.inject({ method: 'DELETE', url: `/v1/web/sessions/${laptopId}`, ...as(phoneToken, wifiPhone) });
    expect(phoneRemovesLaptop.statusCode).toBe(403);
    expect(phoneRemovesLaptop.json().error.code).toBe('manage_from_computer');

    const removed = await t.app.inject({
      method: 'DELETE', url: `/v1/web/sessions/${phoneId}`, remoteAddress: '127.0.0.1', headers: { ...laptop, cookie: `llmgw_session=${laptopToken}` },
    });
    expect(removed.statusCode).toBe(204);
    const after = await t.app.inject({ method: 'GET', url: '/v1/me', ...as(phoneToken, wifiPhone) });
    expect(after.statusCode).toBe(401);
    expect(after.json().error.code).toBe('session_expired');

    expect((await t.app.inject({ method: 'DELETE', url: `/v1/web/sessions/${phoneId}`, headers: key })).statusCode).toBe(404);
  });

  it('a phone can sign itself out through the devices list', async () => {
    const token = cookieOf(await redeem((await code('pair')).json().code, wifiPhone)).value;
    const id = (await t.app.inject({ method: 'GET', url: '/v1/web/sessions', ...as(token, wifiPhone) })).json().data[0].id;
    expect((await t.app.inject({ method: 'DELETE', url: `/v1/web/sessions/${id}`, ...as(token, wifiPhone) })).statusCode).toBe(204);
  });

  describe('through tailscale serve (connects from 127.0.0.1, forwards the phone)', () => {
    it('counts as the network: an llm open link is refused, a pairing code works, the cookie is Secure', async () => {
      const open = await redeem((await code('open')).json().code, tailscalePhone);
      expect(open.json().error.code).toBe('open_link_local_only');
      const paired = await redeem((await code('pair')).json().code, tailscalePhone);
      expect(paired.statusCode).toBe(204);
      expect(cookieOf(paired).secure).toBe(true);
      const token = cookieOf(paired).value;
      const me = await t.app.inject({ method: 'GET', url: '/v1/me', ...as(token, tailscalePhone) });
      expect(me.statusCode).toBe(200);
      const pair = await t.app.inject({ method: 'POST', url: '/v1/web/codes', ...as(token, tailscalePhone), payload: { purpose: 'pair' } });
      expect(pair.json().error.code).toBe('pair_from_computer');
    });

    it('checks the forwarded host and origin like a direct request', async () => {
      const token = cookieOf(await redeem((await code('pair')).json().code, tailscalePhone)).value;
      const evil = { ...tailscalePhone, headers: { ...tailscalePhone.headers, 'x-forwarded-host': 'evil.example' } };
      expect((await t.app.inject({ method: 'GET', url: '/v1/me', ...as(token, evil) })).json().error.code).toBe('forbidden_host');
      const otherOrigin = { ...tailscalePhone, headers: { ...tailscalePhone.headers, origin: 'https://evil.example' } };
      const post = await t.app.inject({ method: 'POST', url: '/v1/conversations', ...as(token, otherOrigin), payload: {} });
      expect(post.json().error.code).toBe('bad_origin');
    });
  });

  it('phone info: the computer may pair, a phone may not', async () => {
    const byKey = await t.app.inject({ method: 'GET', url: '/v1/web/phone', headers: key });
    expect(byKey.json()).toMatchObject({ canPair: true, wifi: { listening: false, urls: [] } });
    const token = cookieOf(await redeem((await code('pair')).json().code, wifiPhone)).value;
    expect((await t.app.inject({ method: 'GET', url: '/v1/web/phone', ...as(token, wifiPhone) })).json().canPair).toBe(false);
  });

  it('a phone address that is not this machine is refused', async () => {
    const stranger = { remoteAddress: '192.168.1.99', headers: { host: '192.168.1.99:3000', origin: 'http://192.168.1.99:3000', 'user-agent': IPHONE } };
    const res = await redeem((await code('pair')).json().code, stranger);
    expect(res.json().error.code).toBe('forbidden_host');
  });
});
