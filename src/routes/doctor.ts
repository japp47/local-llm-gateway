import type { FastifyPluginAsync } from 'fastify';
import type { Deps } from '../app.js';
import { gatewayChecks } from '../services/doctor.js';

/**
 * The gateway's own view of its health, for `llm doctor`. Behind auth: it names models
 * and versions. It never includes paths or URLs with credentials.
 */
export const doctorRoutes: FastifyPluginAsync<{ deps: Deps }> = async (app, { deps }) => {
  app.get('/doctor', async () => ({
    mode: deps.config.mode,
    checks: await gatewayChecks({
      mode: deps.config.mode,
      models: deps.models,
      ollama: deps.ollama,
      defaultModel: deps.config.models.defaultModel,
      contextTokens: deps.config.MODEL_CONTEXT_TOKENS,
      storage: deps.storage,
    }),
  }));
};
