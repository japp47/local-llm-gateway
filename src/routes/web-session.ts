// Browser sign-in endpoints (the web chat). See services/web-session.service.ts for the rules
// and plugins/web-guard.ts for the host and origin checks.
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { RedeemCodeBody } from '../api/schemas.js';
import type { Deps } from '../app.js';
import { AppError } from '../lib/errors.js';
import { allowedHost, sameOrigin, SESSION_COOKIE } from '../plugins/web-guard.js';

/** Sign-in and sign-out are reached from the page: the same host and origin rules apply. */
function guard(req: FastifyRequest, webHosts: readonly string[]) {
  if (!allowedHost(req.headers.host, webHosts)) {
    throw new AppError(403, 'forbidden_host', 'This address is not allowed to sign in.');
  }
  // Browsers always send Origin on a cross-site POST/DELETE; a non-browser client may send none.
  if (req.headers.origin !== undefined && !sameOrigin(req.headers.origin, req.headers.host)) {
    throw new AppError(403, 'bad_origin', 'This request did not come from the assistant\'s own page.');
  }
}

const cookieOptions = (req: FastifyRequest) => ({
  httpOnly: true, // the page's scripts can't read it, so injected scripts can't steal it
  sameSite: 'strict' as const, // other sites' requests don't carry it
  path: '/',
  secure: req.protocol === 'https', // http://localhost has no TLS; over HTTPS (e.g. Tailscale) it's Secure
});

/** POST /v1/web/codes, inside the authenticated /v1 scope. */
export const webCodeRoutes: FastifyPluginAsync<{ deps: Deps }> = async (app, { deps }) => {
  app.post('/web/codes', async (req, reply) => {
    if (req.auth?.via !== 'key') {
      throw new AppError(403, 'key_required', 'Only an API key can create a sign-in link.', { hint: 'Run llm open in a terminal.' });
    }
    const { code, expiresAt } = await deps.webSessions.createCode(req.auth.userId);
    return reply.code(201).send({ code, expiresAt: expiresAt.toISOString() });
  });
};

/** POST and DELETE /web/session: public paths (the page has no key), guarded by host and origin. */
export const webSessionRoutes: FastifyPluginAsync<{ deps: Deps }> = async (app, { deps }) => {
  app.post('/web/session', async (req, reply: FastifyReply) => {
    guard(req, deps.config.webHosts);
    const { code } = RedeemCodeBody.parse(req.body);
    const session = await deps.webSessions.redeem(code);
    if (!session) {
      throw new AppError(401, 'invalid_code', 'This sign-in link has expired or was already used.', {
        hint: 'Run llm open again for a new one.',
      });
    }
    reply.setCookie(SESSION_COOKIE, session.token, { ...cookieOptions(req), maxAge: session.maxAgeSeconds });
    return reply.code(204).send();
  });

  app.delete('/web/session', async (req, reply: FastifyReply) => {
    guard(req, deps.config.webHosts);
    const token = req.cookies[SESSION_COOKIE];
    if (token) await deps.webSessions.signOut(token);
    reply.clearCookie(SESSION_COOKIE, cookieOptions(req));
    return reply.code(204).send();
  });
};
