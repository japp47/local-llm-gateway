import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { Redis } from 'ioredis';
import { config } from './config.js';
import { requireApiKey } from './plugins/auth.js';
import { chatRoutes } from './routes/chat.js';
import { healthRoutes } from './routes/health.js';

export async function buildApp() {
  const app = Fastify({ logger: { level: 'info' }, bodyLimit: 1_000_000 });

  const redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 500,
    enableOfflineQueue: false, // fail fast if Redis is down
  });
  redis.on('error', (e) => app.log.warn({ err: e.message }, 'redis error'));
  app.addHook('onClose', async () => { redis.disconnect(); });

  await app.register(healthRoutes);

  await app.register(
    async (v1) => {
      v1.addHook('onRequest', requireApiKey); // auth first
      await v1.register(rateLimit, {
        max: config.RATE_LIMIT_MAX,
        timeWindow: config.RATE_LIMIT_WINDOW,
        redis,
        nameSpace: 'llmgw:',
        skipOnError: true, // if Redis dies, serve traffic instead of failing
        keyGenerator: (req) => req.headers.authorization ?? req.ip,
      });
      await v1.register(chatRoutes);
    },
    { prefix: '/v1' },
  );

  return app;
}