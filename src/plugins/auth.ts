import type { FastifyReply, FastifyRequest } from 'fastify';
import { apiKeys } from '../config.js';

export async function requireApiKey(req: FastifyRequest, reply: FastifyReply) {
  const h = req.headers.authorization;
  const key = h?.startsWith('Bearer ') ? h.slice(7) : undefined;
  if (!key || !apiKeys.has(key)) {
    return reply
      .code(401)
      .send({ error: { message: 'invalid api key', type: 'auth_error' } });
  }
}