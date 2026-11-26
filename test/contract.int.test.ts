// API contract: real responses checked against the published OpenAPI document (not against
// zod), on both storage backends. Also checks that every route is documented, that the
// document is internally consistent, and that docs/openapi.json is up to date.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildOpenApi } from '../src/api/openapi.js';
import { buildApp } from '../src/app.js';
import { createConfig } from '../src/config.js';
import { ollamaUnavailable } from '../src/providers/ollama-errors.js';
import type { OllamaInfo } from '../src/services/doctor.js';
import { OPENAPI_FILE, render } from '../scripts/openapi.js';
import { FakeProvider, makeTestApp, parseSse } from './helpers.js';

type Json = Record<string, any>;
const doc = buildOpenApi() as Json;

// Formats are not checked (zod already emits a regex `pattern` next to each format).
const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
ajv.addSchema({ $id: 'doc', components: doc.components });
const compiled = new Map<string, ValidateFunction>();
function validatorFor(schema: Json): ValidateFunction {
  const text = JSON.stringify(schema).replaceAll('"#/components/', '"doc#/components/');
  let v = compiled.get(text);
  if (!v) compiled.set(text, (v = ajv.compile(JSON.parse(text))));
  return v;
}

/** Path template from the document that matches a concrete URL. */
function templateFor(url: string): string | undefined {
  const path = url.split('?')[0]!;
  return Object.keys(doc.paths).find((t) => new RegExp(`^${t.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(path));
}

const covered = new Set<string>();

/** Fails unless the response's status, content type and body are all in the document. */
function conforms(method: string, url: string, res: LightMyRequestResponse) {
  const tpl = templateFor(url);
  expect(tpl, `${method} ${url} is not in the document`).toBeDefined();
  const op = doc.paths[tpl!][method.toLowerCase()];
  expect(op, `${method} ${tpl} is not in the document`).toBeDefined();
  const spec = op.responses[res.statusCode];
  expect(spec, `${method} ${tpl} returned ${res.statusCode}, which is not documented`).toBeDefined();
  covered.add(`${method.toUpperCase()} ${tpl} ${res.statusCode}`);

  const type = String(res.headers['content-type'] ?? '').split(';')[0];
  if (res.statusCode === 204) return expect(res.payload).toBe('');
  expect(Object.keys(spec.content ?? {}), `${method} ${tpl} ${res.statusCode}: content type`).toContain(type);
  const schema = spec.content[type].schema;

  if (type === 'text/event-stream') {
    const events = parseSse(res.payload);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      const eventSchema = op['x-sse-events']?.[e.event];
      expect(eventSchema, `undocumented event "${e.event}"`).toBeDefined();
      const v = validatorFor(eventSchema);
      expect(v(e.data), `${e.event}: ${ajv.errorsText(v.errors)}`).toBe(true);
    }
  } else if (schema) {
    const v = validatorFor(schema);
    expect(v(res.json()), `${method} ${tpl} ${res.statusCode}: ${ajv.errorsText(v.errors)}`).toBe(true);
  }
}

describe('the OpenAPI document', () => {
  it('is OpenAPI 3.1 and every $ref points at something', () => {
    expect(doc.openapi).toBe('3.1.0');
    const refs = [...JSON.stringify(doc).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(10);
    for (const r of refs) expect(doc.components.schemas, `missing schema ${r}`).toHaveProperty(r);
  });

  it('has a unique operationId per operation', () => {
    const ids = Object.values(doc.paths).flatMap((p: any) => Object.values(p).map((o: any) => o.operationId));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('docs/openapi.json is up to date (if not: npm run openapi)', () => {
    expect(readFileSync(OPENAPI_FILE, 'utf8')).toBe(render());
  });
});

describe('API contract', () => {
  let t: Awaited<ReturnType<typeof makeTestApp>>;
  let provider: FakeProvider;
  let headers: Record<string, string>;

  beforeEach(async () => {
    provider = new FakeProvider();
    // Ollama "not running" for the endpoints that ask it directly: deterministic everywhere.
    t = await makeTestApp(provider, { OLLAMA_URL: 'http://127.0.0.1:9' });
    headers = (await t.addUser('contract@example.com')).headers;
  });
  afterEach(async () => {
    await t.close();
  });

  const call = async (method: string, url: string, payload?: unknown, h: Record<string, string> = headers) => {
    const res = await t.app.inject({ method: method as 'GET', url, headers: h, ...(payload !== undefined ? { payload: payload as object } : {}) });
    conforms(method, url, res);
    return res;
  };

  it('every registered route is documented, and every documented route exists', () => {
    const registered = t.routes
      .map((r) => `${r.method} ${r.url.replace(/:(\w+)/g, '{$1}')}`)
      .filter((r) => !r.endsWith('*')); // Fastify's internal wildcard routes, if any
    const documented = Object.entries(doc.paths).flatMap(([p, ops]: [string, any]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${p}`));
    expect(new Set(registered)).toEqual(new Set(documented));
  });

  it('the web page: served with a strict Content-Security-Policy; its files under /assets/', async () => {
    const page = await call('GET', '/', undefined, {});
    expect(page.payload).toContain('<div id="root">');
    const csp = String(page.headers['content-security-policy']);
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-inline');
    expect(page.headers['x-content-type-options']).toBe('nosniff');
    expect(page.headers['cache-control']).toBe('no-cache'); // a new version reaches phones at once
    const asset = await t.app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toContain('immutable');
  });

  it('health endpoints', async () => {
    await call('GET', '/healthz', undefined, {});
    await call('GET', '/readyz', undefined, {}); // Ollama is "down" here: 503 with the same shape
    await call('GET', '/metrics', undefined, {});
    expect((await call('GET', '/openapi.json', undefined, {})).json()).toEqual(doc);
  });

  it('account, models, doctor, backup', async () => {
    await call('GET', '/v1/me');
    await call('GET', '/v1/me', undefined, {}); // 401
    await call('GET', '/v1/models');
    await call('GET', '/v1/model');
    await call('GET', '/v1/doctor');
    await call('GET', '/v1/stats?hours=0'); // 400
    await call('POST', '/v1/backup'); // server mode: 409 with the pg_dump hint
  });

  it('conversations: the whole life cycle and its errors', async () => {
    const conv = (await call('POST', '/v1/conversations', { title: 'Contract' })).json();
    await call('POST', '/v1/conversations', { model: 'not-a-model' }); // 400 model_not_allowed

    // a complete answer, then one that breaks halfway (error event, partial)
    const sent = await call('POST', `/v1/conversations/${conv.id}/messages`, { content: 'hello' });
    expect(parseSse(sent.payload).map((e) => e.event)).toEqual(['start', 'delta', 'delta', 'meta', 'done']);
    provider.script = { chunks: ['Half', ' an'], failAfter: 1 };
    const broken = await call('POST', `/v1/conversations/${conv.id}/messages`, { content: 'again' });
    expect(parseSse(broken.payload).map((e) => e.event)).toContain('error');
    // refused before starting: plain JSON, nothing saved
    provider.script = { chunks: [], refuse: ollamaUnavailable() };
    await call('POST', `/v1/conversations/${conv.id}/messages`, { content: 'refused' }); // 503
    provider.script = { chunks: ['ok'] };

    await call('GET', '/v1/stats');
    await call('GET', '/v1/conversations?limit=1');
    await call('GET', '/v1/conversations?limit=0'); // 400
    const full = (await call('GET', `/v1/conversations/${conv.id}?limit=2`)).json();
    await call('GET', '/v1/conversations/not-a-uuid'); // 400
    await call('PATCH', `/v1/conversations/${conv.id}`, { title: 'Renamed' });

    const fork = (await call('POST', `/v1/conversations/${conv.id}/forks`, { fromMessageId: full.messages[0].id })).json();
    const missing = '00000000-0000-4000-8000-000000000000';
    await call('POST', `/v1/conversations/${conv.id}/forks`, { fromMessageId: missing }); // 404 message_not_found

    await call('POST', `/v1/conversations/${missing}/messages`, { content: 'x' }); // 404
    await call('GET', `/v1/conversations/${missing}`); // 404
    await call('PATCH', `/v1/conversations/${missing}`, { title: 'x' }); // 404
    await call('DELETE', `/v1/conversations/${fork.id}`); // 204
    await call('DELETE', `/v1/conversations/${fork.id}`); // 404
  });

  it('busy conversation and context too large', async () => {
    const conv = (await call('POST', '/v1/conversations', {})).json();
    provider.hold();
    const first = t.app.inject({ method: 'POST', url: `/v1/conversations/${conv.id}/messages`, headers, payload: { content: 'slow' } });
    await provider.started;
    await call('POST', `/v1/conversations/${conv.id}/messages`, { content: 'impatient' }); // 409
    provider.release();
    conforms('POST', `/v1/conversations/${conv.id}/messages`, await first);
    await call('POST', `/v1/conversations/${conv.id}/messages`, { content: 'x'.repeat(16_000) }); // 413 at 4096 tokens
  });

  it('web sign-in: code, session, a cookie request, sign out, and the refusals', async () => {
    const page = { host: 'localhost:3000', origin: 'http://localhost:3000' };
    const code = (await call('POST', '/v1/web/codes')).json().code;
    const signedIn = await call('POST', '/web/session', { code }, page);
    const token = signedIn.cookies.find((c) => c.name === 'llmgw_session')!.value;
    const browser = { ...page, cookie: `llmgw_session=${token}` };
    await call('POST', '/v1/web/codes', undefined, browser); // 403 key_required
    await call('POST', '/web/session', { code }, page); // 401 invalid_code (used)
    await call('POST', '/web/session', { code: 'x'.repeat(20) }, { host: 'evil.example', origin: 'http://evil.example' }); // 403
    await call('GET', '/v1/me', undefined, browser);
    await call('GET', '/v1/web/phone');
    const devices = (await call('GET', '/v1/web/sessions', undefined, browser)).json().data;
    const phone = { remoteAddress: '192.168.1.20', headers: { host: '192.168.1.20:3000', origin: 'http://192.168.1.20:3000' } };
    const pairCode = (await call('POST', '/v1/web/codes', { purpose: 'pair' })).json().code;
    const paired = await t.app.inject({ method: 'POST', url: '/web/session', ...phone, payload: { code: pairCode } });
    conforms('POST', '/web/session', paired);
    const phoneId = (await call('GET', '/v1/web/sessions')).json().data.find((d: { id: string }) => !devices.some((x: { id: string }) => x.id === d.id)).id;
    await call('DELETE', `/v1/web/sessions/${phoneId}`); // 204
    await call('DELETE', `/v1/web/sessions/${phoneId}`); // 404
    await call('DELETE', '/web/session', undefined, browser);
    await call('GET', '/v1/me', undefined, browser); // 401 session_expired
  });

  it('legacy passthrough: Ollama unreachable is a documented 502', async () => {
    await call('POST', '/v1/chat/completions', { model: 'fake-model', messages: [{ role: 'user', content: 'hi' }] });
  });

  it('unknown URLs use the standard error shape', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/nope', headers });
    expect(res.statusCode).toBe(404);
    expect(validatorFor({ $ref: '#/components/schemas/Error' })(res.json())).toBe(true);
    expect(res.json().error.code).toBe('not_found');
  });
});

describe('API contract: rate limit and single-user-only endpoints', () => {
  it('429 from the rate limiter', async () => {
    const t = await makeTestApp(new FakeProvider(), { RATE_LIMIT_MAX: '1', OLLAMA_URL: 'http://127.0.0.1:9' });
    try {
      const { headers } = await t.addUser('rl@example.com');
      await t.app.inject({ method: 'GET', url: '/v1/me', headers });
      const res = await t.app.inject({ method: 'GET', url: '/v1/me', headers });
      expect(res.statusCode).toBe(429);
      conforms('GET', '/v1/me', res);
    } finally {
      await t.close();
    }
  });

  it('page not built: a plain 404 with what to do (the API keeps working)', async () => {
    const config = createConfig({ DATA_DIR: mkdtempSync(join(tmpdir(), 'llmgw-nopage-')), LOG_LEVEL: 'silent', ALLOWED_MODELS: 'fake-model', DEFAULT_MODEL: 'fake-model' });
    const ollama: OllamaInfo = { version: async () => 'x', installed: async () => [], loaded: async () => [] };
    const { app } = await buildApp({ config, provider: new FakeProvider(), ollama, webRoot: null });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toMatchObject({ code: 'page_not_built' });
      conforms('GET', '/', res);
    } finally {
      await app.close();
      rmSync(config.dataDir, { recursive: true, force: true });
    }
  });

  it('/readyz 200 when Ollama and the database answer', async () => {
    const ollama = createServer((_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end('{"models":[]}'));
    await new Promise<void>((r) => ollama.listen(0, '127.0.0.1', r));
    const t = await makeTestApp(new FakeProvider(), { OLLAMA_URL: `http://127.0.0.1:${(ollama.address() as AddressInfo).port}` });
    try {
      const res = await t.app.inject({ method: 'GET', url: '/readyz' });
      expect(res.statusCode).toBe(200);
      conforms('GET', '/readyz', res);
    } finally {
      await t.close();
      await new Promise((r) => ollama.close(r));
    }
  });

  it('backup in single-user mode: 201', async () => {
    const root = mkdtempSync(join(tmpdir(), 'llmgw-contract-'));
    const ollama: OllamaInfo = { version: async () => 'x', installed: async () => [], loaded: async () => [] };
    const config = createConfig({ DATA_DIR: join(root, 'data'), LOG_LEVEL: 'silent', ALLOWED_MODELS: 'fake-model', DEFAULT_MODEL: 'fake-model' });
    const { app, deps } = await buildApp({ config, provider: new FakeProvider(), ollama });
    try {
      const user = await deps.repos.users.create('single@local');
      const { generateApiKey, sha256 } = await import('../src/lib/hash.js');
      const key = generateApiKey();
      await deps.repos.apiKeys.create(user.id, sha256(key));
      const res = await app.inject({ method: 'POST', url: '/v1/backup', headers: { authorization: `Bearer ${key}` } });
      expect(res.statusCode).toBe(201);
      conforms('POST', '/v1/backup', res);
    } finally {
      await app.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

afterAll(() => {
  // Every documented success response was produced by a real request above.
  const successes = Object.entries(doc.paths).flatMap(([p, ops]: [string, any]) =>
    Object.entries(ops).flatMap(([m, op]: [string, any]) =>
      Object.keys(op.responses)
        .filter((s) => s.startsWith('2'))
        .map((s) => `${m.toUpperCase()} ${p} ${s}`),
    ),
  );
  // The legacy passthrough's 200 needs a fake Ollama; upstream.int.test.ts covers it.
  const missing = successes.filter((s) => !covered.has(s) && s !== 'POST /v1/chat/completions 200');
  expect(missing, 'documented success responses no test produced').toEqual([]);
});
