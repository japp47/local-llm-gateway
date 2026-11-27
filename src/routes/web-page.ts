// Serves the web chat page: `/` (index.html) and `/assets/*` (Vite's hashed files).
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { AppError } from '../lib/errors.js';

/**
 * Only the gateway's own files may run or style the page: no inline code, no other sites.
 * Model answers are shown as text by the page; this is the second line of defence.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'", // no other site may frame the page (clickjacking)
  "object-src 'none'",
].join('; ');

const securityHeaders = (reply: FastifyReply) =>
  reply
    .header('content-security-policy', CONTENT_SECURITY_POLICY)
    .header('x-content-type-options', 'nosniff')
    .header('referrer-policy', 'no-referrer')
    .header('x-frame-options', 'DENY');

export const webPageRoutes: FastifyPluginAsync<{ root: string | null }> = async (app, { root }) => {
  if (root) {
    await app.register(fastifyStatic, {
      root: join(root, 'assets'),
      prefix: '/assets/',
      immutable: true, // file names contain a content hash: cache forever
      maxAge: '365d',
      setHeaders: (res) => void res.header('x-content-type-options', 'nosniff'),
    });
  }

  app.get('/', async (_req, reply) => {
    if (!root) {
      throw new AppError(404, 'page_not_built', "The web page isn't built.", { hint: 'Run: npm run build (or use llm chat)' });
    }
    securityHeaders(reply).header('cache-control', 'no-cache'); // always pick up a new version
    // cacheControl: false, or sendFile would replace no-cache with the assets' one-year rule.
    return reply.sendFile('index.html', root, { cacheControl: false });
  });
};
