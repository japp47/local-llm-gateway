#!/usr/bin/env node
import { buildApp } from './app.js';
import { createConfig } from './config.js';
import { StartupError } from './lib/instance-lock.js';
import { gatewayChecks } from './services/doctor.js';

const config = createConfig();
let built: Awaited<ReturnType<typeof buildApp>>;
let app: (typeof built)['app'];
try {
  built = await buildApp({ config });
  ({ app } = built);
} catch (err) {
  if (!(err instanceof StartupError)) throw err;
  console.error(err.message); // a sentence the user can act on, not a stack trace
  process.exit(1);
}
try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (err) {
  await app.close(); // release storage and the lock before exiting
  if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
  console.error(`Port ${config.PORT} is already in use. Stop the other program, or set PORT to a free one.`);
  process.exit(1);
}

// The same checks as `llm doctor`. Warn, don't fail: Ollama may start (or a model be
// pulled) after the gateway, and requests then work without a restart.
try {
  const { deps } = built;
  const checks = await gatewayChecks({
    mode: config.mode,
    models: deps.models,
    ollama: deps.ollama,
    defaultModel: config.models.defaultModel,
    contextTokens: config.MODEL_CONTEXT_TOKENS,
    storage: deps.storage,
  });
  for (const c of checks) {
    const later = c.id === 'ollama' && c.status === 'fail' ? ' The gateway keeps running and will use it once it starts.' : '';
    const text = `${c.message}${c.hint ? ` ${c.hint}` : ''}${later}`;
    if (c.status === 'ok') app.log.info({ check: c.id }, text);
    else app.log.warn({ check: c.id }, text);
  }
} catch (err) {
  app.log.warn({ err: (err as Error).message }, 'startup checks failed');
}

// Once only: under `llm start`, Ctrl+C arrives twice (from the terminal and forwarded by llm).
let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    if (stopping) return;
    stopping = true;
    app.log.info({ sig }, 'shutting down');
    await app.close(); // closes storage, which releases the single-user lock file
    process.exit(0);
  });
}
