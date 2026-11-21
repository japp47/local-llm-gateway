import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthContext, AuthService } from '../services/auth.service.js';
import type { WebSessionService } from '../services/web-session.service.js';
import { allowedHost, SAFE_METHODS, sameOrigin, SESSION_COOKIE } from './web-guard.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

const deny = (req: FastifyRequest, reply: FastifyReply, status: number, code: string, message: string, hint?: string) =>
  reply.code(status).send({ error: { code, message, ...(hint ? { hint } : {}), request_id: req.id } });

/**
 * Who is calling: an API key (`Authorization: Bearer`, the CLI and scripts) or, for the web
 * page, a session cookie. A key always wins. Cookie requests must also pass the host and
 * origin checks (see web-guard.ts).
 */
export function makeAuthHook(auth: AuthService, web: WebSessionService, webHosts: readonly string[]) {
  return async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
    const header = req.headers.authorization;
    const key = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    if (key) {
      const ctx = await auth.authenticate(key);
      if (!ctx) return deny(req, reply, 401, 'invalid_api_key', 'invalid api key');
      req.auth = { ...ctx, via: 'key' };
      return;
    }

    const token = req.cookies?.[SESSION_COOKIE];
    if (token) {
      if (!allowedHost(req.headers.host, webHosts)) {
        return deny(req, reply, 403, 'forbidden_host', 'This address is not allowed to use a signed-in session.');
      }
      if (!SAFE_METHODS.has(req.method) && !sameOrigin(req.headers.origin, req.headers.host)) {
        return deny(req, reply, 403, 'bad_origin', 'This request did not come from the assistant\'s own page.');
      }
      const session = await web.authenticate(token);
      if (session) {
        req.auth = { userId: session.userId, keyId: `session:${session.sessionId}`, via: 'session' };
        return;
      }
      return deny(req, reply, 401, 'session_expired', 'Your sign-in has ended.', 'Sign in again: run llm open');
    }

    return deny(req, reply, 401, 'invalid_api_key', 'invalid api key');
  };
}
