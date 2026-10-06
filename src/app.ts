import { randomBytes } from 'node:crypto';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { Redis } from 'ioredis';
import { ZodError } from 'zod';
import { createConfig, type config } from './config.js';
import { createDb, type Database, type Db } from './db/client.js';
import { AppError } from './lib/errors.js';
import { Semaphore } from './lib/semaphore.js';
import { HeuristicTokenCounter } from './lib/tokens.js';
import { makeAuthHook } from './plugins/auth.js';
import { createMetrics, type Metrics } from './plugins/metrics.js';
import { OllamaProvider } from './providers/ollama.js';
import type { LLMProvider } from './providers/types.js';
import { ConversationsRepo } from './repositories/conversations.js';
import { GenerationsRepo } from './repositories/generations.js';
import { ApiKeysRepo, UsersRepo } from './repositories/identity.js';
import { MessagesRepo } from './repositories/messages.js';
import { chatRoutes } from './routes/chat.js';
import { conversationRoutes } from './routes/conversations.js';
import { healthRoutes } from './routes/health.js';
import { modelRoutes } from './routes/models.js';
import { AuthService } from './services/auth.service.js';
import { ConversationService } from './services/conversation.service.js';
import { ModelsService } from './services/models.service.js';
import { ModelsRepo } from './repositories/models.js';

export interface Deps {
  config: config;
  db: Db;
  limiter: Semaphore;
  metrics: Metrics;
  provider: LLMProvider;
  auth: AuthService;
  conversations: ConversationService;
  models: ModelsService;
  repos: {
    users: UsersRepo;
    apiKeys: ApiKeysRepo;
    conversations: ConversationsRepo;
    messages: MessagesRepo;
    generations: GenerationsRepo;
    models: ModelsRepo;
  };
}

export interface BuildOptions {
  config?: config;
  provider?: LLMProvider;
  database?: Database;
}

export async function buildApp(opts: BuildOptions = {}) {
  const config = opts.config ?? createConfig();
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    bodyLimit: 1_000_000,
    genReqId: () => `req_${randomBytes(6).toString('hex')}`, // never trust client-supplied ids
  });

  app.decorateRequest('auth', null);
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      for (const [k, v] of Object.entries(err.headers)) reply.header(k, v);
      return reply.code(err.status).send({
        error: { code: err.code, message: err.message, request_id: req.id },
      });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'invalid_request',
          message: 'invalid request',
          details: err.issues,
          request_id: req.id,
        },
      });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    return reply.code(status).send({
      error: {
        code: status === 429 ? 'rate_limited' : status >= 500 ? 'internal_error' : 'bad_request',
        message: status >= 500 ? 'internal error' : (err as Error).message,
        request_id: req.id,
      },
    });
  });

  // ---- composition root ----
  const database = opts.database ?? createDb(config.DATABASE_URL);
  const ownsDb = !opts.database;
  const db = database.db;
  const repos = {
    users: new UsersRepo(db),
    apiKeys: new ApiKeysRepo(db),
    conversations: new ConversationsRepo(db),
    messages: new MessagesRepo(db),
    generations: new GenerationsRepo(db),
    models: new ModelsRepo(config.allowedModels),
  };
  const limiter = new Semaphore(config.MAX_CONCURRENCY, config.MAX_QUEUE);
  const metrics = createMetrics(limiter);
  const provider = opts.provider ?? new OllamaProvider(config.OLLAMA_URL);
  const auth = new AuthService(repos.apiKeys);
  const models = new ModelsService(repos.models, config.DEFAULT_MODEL);
  const conversations = new ConversationService({
    config,
    provider,
    limiter,
    metrics,
    counter: new HeuristicTokenCounter(),
    conversations: repos.conversations,
    messages: repos.messages,
    generations: repos.generations,
  });
  const deps: Deps = { config, db, limiter, metrics, provider, auth, conversations, models, repos };

  let redis: Redis | null = null;
  if (config.REDIS_URL) {
    redis = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 500,
      enableOfflineQueue: false, // fail fast if Redis is down
    });
    redis.on('error', (e) => app.log.warn({ err: e.message }, 'redis error'));
  }

  app.addHook('onClose', async () => {
    redis?.disconnect();
    if (ownsDb) await database.close();
  });

  // ---- routes ----
  await app.register(healthRoutes, { deps });

  await app.register(
    async (v1) => {
      v1.addHook('onRequest', makeAuthHook(auth)); // auth first, so rate limiting can key on the key id
      await v1.register(rateLimit, {
        max: config.RATE_LIMIT_MAX,
        timeWindow: config.RATE_LIMIT_WINDOW,
        ...(redis ? { redis } : {}),
        nameSpace: 'llmgw:',
        skipOnError: true, // if Redis dies, serve traffic instead of failing
        keyGenerator: (req) => req.auth?.keyId ?? req.ip, // never the raw key
      });
      await v1.register(modelRoutes, { deps });
      await v1.register(chatRoutes, { deps });
      await v1.register(conversationRoutes, { deps });
    },
    { prefix: '/v1' },
  );

  return { app, deps };
}