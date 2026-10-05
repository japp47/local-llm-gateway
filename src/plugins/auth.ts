import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthContext, AuthService } from '../services/auth.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

export function makeAuthHook(auth: AuthService) {
  return async function requireApiKey(req: FastifyRequest, reply: FastifyReply) {
    const header = req.headers.authorization;
    const key = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    const ctx = key ? await auth.authenticate(key) : null;
    if (!ctx) {
      return reply.code(401).send({
        error: { code: 'invalid_api_key', message: 'invalid api key', request_id: req.id },
      });
    }
    req.auth = ctx;
  };
}