import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelsRepo } from '../src/repositories/models.js';
import { modelRoutes } from '../src/routes/models.js';
import { ModelsService } from '../src/services/models.service.js';

describe('model routes', () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('lists allowed models and identifies the configured default', async () => {
    const app = Fastify();
    apps.push(app);
    const models = new ModelsService(new ModelsRepo(new Set(['llama3.2:3b', 'backend-mentor'])), 'llama3.2:3b');
    await app.register(modelRoutes, { deps: { models } });

    const response = await app.inject({ method: 'GET', url: '/models' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: [
        { id: 'llama3.2:3b', default: true },
        { id: 'backend-mentor', default: false },
      ],
    });
  });

  it('returns an empty list when no models are allowed', async () => {
    const app = Fastify();
    apps.push(app);
    const models = new ModelsService(new ModelsRepo(new Set()), 'llama3.2:3b');
    await app.register(modelRoutes, { deps: { models } });

    const response = await app.inject({ method: 'GET', url: '/models' });
    expect(response.json()).toEqual({ data: [] });
  });

  it('returns the configured default model from the singular route', async () => {
    const app = Fastify();
    apps.push(app);
    const models = new ModelsService(new ModelsRepo(new Set(['llama3.2:3b', 'backend-mentor'])), 'llama3.2:3b');
    await app.register(modelRoutes, { deps: { models } });

    const response = await app.inject({ method: 'GET', url: '/model' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: 'llama3.2:3b', default: true });
  });
});
