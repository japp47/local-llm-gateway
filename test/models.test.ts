import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors.js';
import { ollamaUnavailable } from '../src/providers/ollama-errors.js';
import type { InstalledModel } from '../src/providers/ollama-models.js';
import { modelRoutes } from '../src/routes/models.js';
import { ModelsService, type ModelsOptions } from '../src/services/models.service.js';

const GB = 1e9;
const llama: InstalledModel = {
  name: 'llama3.2:3b',
  sizeBytes: 2.02 * GB,
  capabilities: ['completion', 'tools'],
  arch: { blockCount: 28, headCountKv: 8, keyLength: 128, valueLength: 128 },
};
const mentor: InstalledModel = { ...llama, name: 'backend-mentor:latest' };
const embed: InstalledModel = { name: 'nomic-embed-text:latest', sizeBytes: 0.27 * GB, capabilities: ['embedding'] };

/** A stand-in for Ollama's model list that can change and fail, and counts calls. */
function source(initial: InstalledModel[]) {
  const s = {
    models: initial,
    down: false,
    calls: 0,
    async installed() {
      s.calls++;
      if (s.down) throw ollamaUnavailable('ECONNREFUSED');
      return s.models;
    },
  };
  return s;
}

const discovered = (src: ReturnType<typeof source>, extra: Partial<ModelsOptions> = {}) =>
  new ModelsService({ source: src, totalMemoryBytes: 16 * 2 ** 30, contextTokens: 4096, ...extra });

const fixed = (allowed: string[], defaultModel: string) =>
  new ModelsService({ allowed, defaultModel, totalMemoryBytes: 16 * 2 ** 30, contextTokens: 4096 });

async function rejection(p: Promise<unknown>): Promise<AppError> {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

describe('model routes', () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function routes(models: ModelsService) {
    const app = Fastify();
    apps.push(app);
    await app.register(modelRoutes, { deps: { models } });
    return app;
  }

  it('lists allowed models and identifies the configured default', async () => {
    const app = await routes(fixed(['llama3.2:3b', 'backend-mentor'], 'llama3.2:3b'));
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
    const app = await routes(fixed([], 'llama3.2:3b'));
    expect((await app.inject({ method: 'GET', url: '/models' })).json()).toEqual({ data: [] });
  });

  it('returns the configured default model from the singular route', async () => {
    const app = await routes(fixed(['llama3.2:3b', 'backend-mentor'], 'llama3.2:3b'));
    const response = await app.inject({ method: 'GET', url: '/model' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: 'llama3.2:3b', default: true });
  });
});

describe('ModelsService with fixed settings (server mode)', () => {
  it('accepts listed models and refuses others, without asking Ollama', async () => {
    const models = fixed(['llama3.2:3b'], 'llama3.2:3b');
    await expect(models.check('llama3.2:3b')).resolves.toBeUndefined();
    expect((await rejection(models.check('gpt-4'))).code).toBe('model_not_allowed');
  });
});

describe('ModelsService discovering from Ollama (single-user mode)', () => {
  it('lists installed chat models, leaves out embedding models, and marks the picked default', async () => {
    const models = discovered(source([mentor, llama, embed]));
    expect(await models.list()).toEqual([
      { id: 'backend-mentor:latest', default: false },
      { id: 'llama3.2:3b', default: true }, // on our preferred list
    ]);
  });

  it('settings still win: DEFAULT_MODEL and ALLOWED_MODELS', async () => {
    const src = source([mentor, llama]);
    expect((await discovered(src, { defaultModel: 'backend-mentor' }).getDefault()).id).toBe('backend-mentor');
    const limited = discovered(src, { allowed: ['backend-mentor'] });
    expect((await limited.list()).map((m) => m.id)).toEqual(['backend-mentor:latest']);
    expect((await rejection(limited.check('llama3.2:3b'))).code).toBe('model_not_allowed');
  });

  it('explains a model that is not downloaded, with the exact pull command', async () => {
    const err = await rejection(discovered(source([llama])).check('qwen3:4b'));
    expect(err).toMatchObject({ status: 400, code: 'model_not_installed', hint: 'Run: ollama pull qwen3:4b' });
  });

  it('accepts names without a tag, as Ollama does ("x" means "x:latest")', async () => {
    await expect(discovered(source([mentor])).check('backend-mentor')).resolves.toBeUndefined();
  });

  it('refuses an embedding-only model for chat', async () => {
    expect((await rejection(discovered(source([llama, embed])).check('nomic-embed-text'))).code).toBe('model_cannot_chat');
  });

  it('sees a model pulled a moment ago without waiting for the cache to expire', async () => {
    const src = source([llama]);
    const models = discovered(src, { cacheMs: 60_000 });
    await models.list(); // fills the cache
    src.models = [llama, { ...llama, name: 'qwen3:4b' }]; // `ollama pull qwen3:4b`
    await expect(models.check('qwen3:4b')).resolves.toBeUndefined();
  });

  it('reuses the installed list within the cache window', async () => {
    let t = 0;
    const src = source([llama]);
    const models = discovered(src, { cacheMs: 1000, now: () => t });
    await models.check('llama3.2:3b');
    await models.check('llama3.2:3b');
    expect(src.calls).toBe(1);
    t = 1001;
    await models.check('llama3.2:3b');
    expect(src.calls).toBe(2);
  });

  it('says Ollama is not running, and does not remember that failure', async () => {
    const src = source([llama]);
    src.down = true;
    const models = discovered(src);
    expect(await rejection(models.list())).toMatchObject({ status: 503, code: 'ollama_unavailable' });
    src.down = false; // the user opened the Ollama app
    expect((await models.getDefault()).id).toBe('llama3.2:3b');
  });

  it('tells the user what to download when nothing is installed', async () => {
    const err = await rejection(discovered(source([embed])).getDefault());
    expect(err).toMatchObject({ status: 503, code: 'no_model_installed', hint: 'Run: ollama pull qwen3:8b' });
  });
});
