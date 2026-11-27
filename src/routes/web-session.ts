// Browser sign-in endpoints (the web chat). See services/web-session.service.ts for the rules
// and plugins/web-guard.ts for the host and origin checks.
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { IdParams, RedeemCodeBody, WebCodeBody } from '../api/schemas.js';
import type { Deps } from '../app.js';
import { AppError } from '../lib/errors.js';
import { isLocalRequest, lanAddresses, requestHost, requestProtocol } from '../lib/network.js';
import { allowedHost, sameOrigin, SESSION_COOKIE } from '../plugins/web-guard.js';
import { listenHost } from '../config.js';

/** Sign-in and sign-out are reached from the page: the same host and origin rules apply. */
function guard(req: FastifyRequest, deps: Deps) {
  const host = requestHost(req);
  if (!allowedHost(host, deps.webHosts.list())) {
    throw new AppError(403, 'forbidden_host', 'This address is not allowed to sign in.');
  }
  // Browsers always send Origin on a cross-site POST/DELETE; a non-browser client may send none.
  if (req.headers.origin !== undefined && !sameOrigin(req.headers.origin, host)) {
    throw new AppError(403, 'bad_origin', 'This request did not come from the assistant\'s own page.');
  }
}

const cookieOptions = (req: FastifyRequest) => ({
  httpOnly: true, // the page's scripts can't read it, so injected scripts can't steal it
  sameSite: 'strict' as const, // other sites' requests don't carry it
  path: '/',
  // HTTPS (e.g. through Tailscale): Secure. http://localhost or Wi-Fi: no TLS to require.
  secure: requestProtocol(req, req.protocol) === 'https',
});

/**
 * May this caller pair devices or manage other devices? An API key (the CLI on this
 * computer), or a browser that was signed in on this computer and is still on it.
 * A paired phone never may: a stolen phone can't add more phones.
 */
const onThisComputer = (req: FastifyRequest) =>
  req.auth?.via === 'key' || (req.auth?.sessionFrom === 'local' && isLocalRequest(req));

/** Inside the authenticated /v1 scope: codes, devices, phone info. */
export const webCodeRoutes: FastifyPluginAsync<{ deps: Deps }> = async (app, { deps }) => {
  app.post('/web/codes', async (req, reply) => {
    const { purpose } = WebCodeBody.parse(req.body ?? {});
    if (purpose === 'open' && req.auth?.via !== 'key') {
      throw new AppError(403, 'key_required', 'Only an API key can create a sign-in link.', { hint: 'Run llm open in a terminal.' });
    }
    if (purpose === 'pair' && !onThisComputer(req)) {
      throw new AppError(403, 'pair_from_computer', 'Phones can only be connected from the computer running the assistant.', {
        hint: 'On that computer, run llm phone (or use "Connect a phone" there).',
      });
    }
    const { code, expiresAt } = await deps.webSessions.createCode(req.auth!.userId, purpose);
    return reply.code(201).send({ code, expiresAt: expiresAt.toISOString() });
  });

  app.get('/web/sessions', async (req) => {
    const devices = await deps.webSessions.devices(req.auth!.userId);
    return {
      data: devices.map((d) => ({
        id: d.id,
        deviceName: d.deviceName,
        createdFrom: d.createdFrom,
        createdAt: d.createdAt.toISOString(),
        lastSeenAt: d.lastSeenAt.toISOString(),
        current: d.id === req.auth!.sessionId,
      })),
    };
  });

  app.delete('/web/sessions/:id', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    // A phone may sign itself out; removing other devices happens on the computer.
    if (id !== req.auth!.sessionId && !onThisComputer(req)) {
      throw new AppError(403, 'manage_from_computer', 'Devices can only be removed from the computer running the assistant.', {
        hint: 'On that computer: llm devices, or Devices in the page.',
      });
    }
    if (!(await deps.webSessions.revokeDevice(req.auth!.userId, id))) {
      throw new AppError(404, 'device_not_found', 'No such signed-in device.');
    }
    return reply.code(204).send();
  });

  app.get('/web/phone', async (req) => {
    const ts = deps.webHosts.tailscaleInfo();
    const listening = !['127.0.0.1', 'localhost', '::1'].includes(listenHost(deps.config));
    return {
      canPair: onThisComputer(req),
      wifi: { listening, urls: listening ? lanAddresses().map((a) => `http://${a}:${deps.config.PORT}`) : [] },
      tailscale: { name: ts?.name ?? null, url: ts ? `https://${ts.name}` : null, serving: ts?.serving ?? false },
    };
  });
};

/** POST and DELETE /web/session: public paths (the page has no key), guarded by host and origin. */
export const webSessionRoutes: FastifyPluginAsync<{ deps: Deps }> = async (app, { deps }) => {
  app.post('/web/session', async (req, reply: FastifyReply) => {
    guard(req, deps);
    const { code } = RedeemCodeBody.parse(req.body);
    const result = await deps.webSessions.redeem(code, { local: isLocalRequest(req), userAgent: req.headers['user-agent'] });
    if (result.kind === 'local_only') {
      throw new AppError(403, 'open_link_local_only', 'This sign-in link only works on the computer running the assistant.', {
        hint: 'To connect a phone, use the QR code from llm phone.',
      });
    }
    if (result.kind === 'invalid') {
      throw new AppError(401, 'invalid_code', 'This sign-in link has expired or was already used.', {
        hint: 'Run llm open again for a new one (llm phone for a phone).',
      });
    }
    reply.setCookie(SESSION_COOKIE, result.token, { ...cookieOptions(req), maxAge: result.maxAgeSeconds });
    return reply.code(204).send();
  });

  app.delete('/web/session', async (req, reply: FastifyReply) => {
    guard(req, deps);
    const token = req.cookies[SESSION_COOKIE];
    if (token) await deps.webSessions.signOut(token);
    reply.clearCookie(SESSION_COOKIE, cookieOptions(req));
    return reply.code(204).send();
  });
};
