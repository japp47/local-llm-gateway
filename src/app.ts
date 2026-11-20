import { randomBytes } from 'node:crypto';
import { totalmem } from 'node:os';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { Redis } from 'ioredis';
import { ZodError } from 'zod';
import { createConfig, type config } from './config.js';
import { AppError } from './lib/errors.js';
import { Semaphore } from './lib/semaphore.js';
import { HeuristicTokenCounter } from './lib/tokens.js';
import { makeAuthHook } from './plugins/auth.js';
import { createMetrics, type Metrics } from './plugins/metrics.js';
import { OllamaProvider } from './providers/ollama.js';
import { OllamaModels } from './providers/ollama-models.js';
import type { LLMProvider } from './providers/types.js';
import { chatRoutes } from './routes/chat.js';
import { conversationRoutes } from './routes/conversations.js';
import { healthRoutes } from './routes/health.js';
import { modelRoutes } from './routes/models.js';
import { AuthService } from './services/auth.service.js';
import { ConversationService } from './services/conversation.service.js';
import { ensureLocalIdentity } from './services/local-identity.js';
import { makeFitChecker } from './services/model-fit.js';
import type { OllamaInfo } from './services/doctor.js';
import { ModelsService } from './services/models.service.js';
import {
  openStorage,
  sqlitePath,
  type ApiKeysStore,
  type ConversationsStore,
  type GenerationsStore,
  type MessagesStore,
  type Storage,
  type UsersStore,
} from './storage/index.js';
import { meRoutes } from './routes/me.js';
import { statsRoutes } from './routes/stats.js';
import { doctorRoutes } from './routes/doctor.js';
import { backupRoutes } from './routes/backup.js';

export interface Deps {
  config: config;
  storage: Storage;
  limiter: Semaphore;
  metrics: Metrics;
  provider: LLMProvider;
  /** Model metadata from Ollama (installed, loaded). Used for model discovery and diagnostics. */
  ollama: OllamaInfo;
  auth: AuthService;
  conversations: ConversationService;
  models: ModelsService;
  repos: {
    users: UsersStore;
    apiKeys: ApiKeysStore;
    conversations: ConversationsStore;
    messages: MessagesStore;
    generations: GenerationsStore;
  };
}

export interface BuildOptions {
  config?: config;
  provider?: LLMProvider;
  storage?: Storage;
  /** Tests: stand-ins for Ollama's metadata API and this machine's memory. */
  ollama?: OllamaInfo;
  totalMemoryBytes?: number;
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
        error: { code: err.code, message: err.message, ...(err.hint ? { hint: err.hint } : {}), request_id: req.id },
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
  const storage = opts.storage ?? (await openStorage(config));
  const ownsStorage = !opts.storage;
  // Single-user first run: create the local user and key, and leave them for the CLI.
  const localIdentity =
    config.mode === 'single' && ownsStorage ? await ensureLocalIdentity(storage, config) : null;
  const repos = {
    users: storage.users,
    apiKeys: storage.apiKeys,
    conversations: storage.conversations,
    messages: storage.messages,
    generations: storage.generations,
  };
  const limiter = new Semaphore(config.MAX_CONCURRENCY, config.MAX_QUEUE);
  const metrics = createMetrics(limiter);
  const provider = opts.provider ?? new OllamaProvider(config.OLLAMA_URL);
  const ollama = opts.ollama ?? new OllamaModels(config.OLLAMA_URL);
  const auth = new AuthService(repos.apiKeys);
  const models = new ModelsService({
    ...config.models,
    source: ollama,
    totalMemoryBytes: opts.totalMemoryBytes ?? totalmem(),
    contextTokens: config.MODEL_CONTEXT_TOKENS,
  });
  const conversations = new ConversationService({
    config,
    provider,
    models,
    // Only for real Ollama: a test's fake provider has nothing loaded to inspect.
    onAnswered: opts.provider
      ? undefined
      : makeFitChecker(ollama, config.MODEL_CONTEXT_TOKENS, (msg) => app.log.warn(msg)),
    limiter,
    metrics,
    counter: new HeuristicTokenCounter(),
    conversations: repos.conversations,
    messages: repos.messages,
    generations: repos.generations,
  });
  const deps: Deps = { config, storage, limiter, metrics, provider, ollama, auth, conversations, models, repos };

  let redis: Redis | null = null;
  if (config.REDIS_URL) {
    redis = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 500,
      enableOfflineQueue: false, // fail fast if Redis is down
    });
    redis.on('error', (e) => app.log.warn({ err: e.message }, 'redis error'));
  }
  app.log.info(
    {
      mode: config.mode,
      storage: config.mode === 'server' ? 'postgres' : 'sqlite',
      ...(config.mode === 'single' ? { path: sqlitePath(config) } : {}), // never log DATABASE_URL: it holds a password
      rateLimit: redis ? 'redis' : 'memory',
    },
    'gateway configured',
  );
  if (localIdentity) {
    app.log.info(
      { credentials: localIdentity.path }, // the path only, never the key
      localIdentity.created ? 'created a local API key for the CLI' : 'local API key ready',
    );
  }

  app.addHook('onClose', async () => {
    redis?.disconnect();
    if (ownsStorage) await storage.close();
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
      await v1.register(meRoutes, { deps });
      await v1.register(statsRoutes, { deps });
      await v1.register(doctorRoutes, { deps });
      await v1.register(backupRoutes, { deps });
    },
    { prefix: '/v1' },
  );

  return { app, deps };
}