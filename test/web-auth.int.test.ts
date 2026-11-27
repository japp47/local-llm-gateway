// Browser sign-in, end to end through the HTTP API, on both storage backends. The point of
// these tests is the security model: another website must not be able to use the gateway
// through the user's browser (wrong Host, wrong Origin, stolen or reused codes).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeProvider, makeTestApp, parseSse } from './helpers.js';

type T = Awaited<ReturnType<typeof makeTestApp>>;
const HOST = 'localhost:3000';
const ORIGIN = 'http://localhost:3000';

describe('web sign-in', () => {
  let t: T;
  let key: Record<string, string>;

  beforeEach(async () => {
    t = await makeTestApp(new FakeProvider());
    key = (await t.addUser('web@example.com')).headers;
  });
  afterEach(async () => {
    await t.close();
  });

  const newCode = async () => {
    const res = await t.app.inject({ method: 'POST', url: '/v1/web/codes', headers: key });
    expect(res.statusCode).toBe(201);
    return res.json().code as string;
  };
  const signIn = async (code: string, headers: Record<string, string> = { host: HOST, origin: ORIGIN }) =>
    t.app.inject({ method: 'POST', url: '/web/session', headers, payload: { code } });
  /** The session cookie value from a sign-in response. */
  const sessionFrom = (res: Awaited<ReturnType<typeof signIn>>) =>
    res.cookies.find((c) => c.name === 'llmgw_session')!.value;
  const asBrowser = (token: string, extra: Record<string, string> = {}) => ({
    host: HOST,
    cookie: `llmgw_session=${token}`,
    ...extra,
  });

  it('a code from the CLI signs the browser in; the cookie then works for the API', async () => {
    const res = await signIn(await newCode());
    expect(res.statusCode).toBe(204);
    const cookie = res.cookies.find((c) => c.name === 'llmgw_session')!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
    expect(cookie.maxAge).toBe(30 * 24 * 3600);

    const me = await t.app.inject({ method: 'GET', url: '/v1/me', headers: asBrowser(cookie.value) });
    expect(me.json()).toMatchObject({ email: 'web@example.com' });

    // A full chat from the browser: create, then stream an answer (POST needs the right Origin).
    const conv = await t.app.inject({
      method: 'POST', url: '/v1/conversations', headers: asBrowser(cookie.value, { origin: ORIGIN }), payload: { title: 'web' },
    });
    expect(conv.statusCode).toBe(201);
    const sent = await t.app.inject({
      method: 'POST', url: `/v1/conversations/${conv.json().id}/messages`,
      headers: asBrowser(cookie.value, { origin: ORIGIN }), payload: { content: 'hi' },
    });
    expect(parseSse(sent.payload).at(-1)!.data).toMatchObject({ status: 'complete' });
  });

  it('a code works once', async () => {
    const code = await newCode();
    expect((await signIn(code)).statusCode).toBe(204);
    const again = await signIn(code);
    expect(again.statusCode).toBe(401);
    expect(again.json().error).toMatchObject({ code: 'invalid_code', hint: 'Run llm open again for a new one (llm phone for a phone).' });
  });

  it('sign out ends the session and clears the cookie', async () => {
    const token = sessionFrom(await signIn(await newCode()));
    const out = await t.app.inject({ method: 'DELETE', url: '/web/session', headers: asBrowser(token, { origin: ORIGIN }) });
    expect(out.statusCode).toBe(204);
    expect(out.cookies.find((c) => c.name === 'llmgw_session')!.value).toBe('');
    const me = await t.app.inject({ method: 'GET', url: '/v1/me', headers: asBrowser(token) });
    expect(me.statusCode).toBe(401);
    expect(me.json().error).toMatchObject({ code: 'session_expired', hint: 'Sign in again: run llm open' });
  });

  it('only an API key can make sign-in codes, not a signed-in browser', async () => {
    const token = sessionFrom(await signIn(await newCode()));
    const res = await t.app.inject({ method: 'POST', url: '/v1/web/codes', headers: asBrowser(token, { origin: ORIGIN }) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('key_required');
  });

  describe('other websites cannot use it', () => {
    it('DNS rebinding: a cookie request or a sign-in addressed to another host is refused', async () => {
      const token = sessionFrom(await signIn(await newCode()));
      const me = await t.app.inject({ method: 'GET', url: '/v1/me', headers: asBrowser(token, { host: 'evil.example:3000' }) });
      expect(me.statusCode).toBe(403);
      expect(me.json().error.code).toBe('forbidden_host');
      const res = await signIn(await newCode(), { host: 'evil.example:3000', origin: 'http://evil.example:3000' });
      expect(res.json().error.code).toBe('forbidden_host');
    });

    it('CSRF: a state-changing cookie request from another origin (or none) is refused', async () => {
      const token = sessionFrom(await signIn(await newCode()));
      for (const origin of ['http://evil.example', 'null', undefined]) {
        const res = await t.app.inject({
          method: 'POST', url: '/v1/conversations',
          headers: asBrowser(token, origin === undefined ? {} : { origin }), payload: {},
        });
        expect(res.statusCode, String(origin)).toBe(403);
        expect(res.json().error.code).toBe('bad_origin');
      }
      // Reading with a cookie from the gateway's own page needs no Origin (browsers omit it on GET).
      expect((await t.app.inject({ method: 'GET', url: '/v1/conversations', headers: asBrowser(token) })).statusCode).toBe(200);
    });

    it('a sign-in posted from another site is refused even with a valid code', async () => {
      const res = await signIn(await newCode(), { host: HOST, origin: 'http://evil.example' });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('bad_origin');
    });

    it('a made-up session token is not a session', async () => {
      const res = await t.app.inject({ method: 'GET', url: '/v1/me', headers: asBrowser('not-a-real-token') });
      expect(res.statusCode).toBe(401);
    });
  });

  it('API keys are unaffected by the browser checks (any Host, no Origin)', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/v1/conversations', headers: { ...key, host: 'office-box.lan:3000' }, payload: {} });
    expect(res.statusCode).toBe(201);
  });

  it('WEB_HOSTS allows an extra host name for the page (a device reaching it by that name pairs)', async () => {
    const t2 = await makeTestApp(new FakeProvider(), { WEB_HOSTS: 'office-box.lan' });
    try {
      const k = (await t2.addUser('web2@example.com')).headers;
      // Another host name is another device: it pairs (an llm open link works only on this computer).
      const code = (await t2.app.inject({ method: 'POST', url: '/v1/web/codes', headers: k, payload: { purpose: 'pair' } })).json().code;
      const res = await t2.app.inject({
        method: 'POST', url: '/web/session', headers: { host: 'office-box.lan:3000', origin: 'http://office-box.lan:3000' }, payload: { code },
      });
      expect(res.statusCode).toBe(204);
    } finally {
      await t2.close();
    }
  });
});
