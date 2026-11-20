import { buildApp } from './app.js';
import { createConfig } from './config.js';
import { StartupError } from './lib/instance-lock.js';
import { startupReport } from './services/startup-report.js';

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

// Warn, don't fail: Ollama may start (or a model be pulled) after the gateway.
try {
  for (const line of await startupReport(built.deps.models, built.deps.ollama, config.models.defaultModel)) {
    app.log[line.level](line.data ?? {}, line.msg);
  }
} catch (err) {
  app.log.warn({ err: (err as Error).message }, 'model check at startup failed');
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    app.log.info({ sig }, 'shutting down');
    await app.close(); // closes storage, which releases the single-user lock file
    process.exit(0);
  });
}
