import { buildApp } from './app.js';
import { createConfig } from './config.js';
import { StartupError } from './lib/instance-lock.js';

const config = createConfig();
let app: Awaited<ReturnType<typeof buildApp>>['app'];
try {
  ({ app } = await buildApp({ config }));
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

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    app.log.info({ sig }, 'shutting down');
    await app.close(); // closes storage, which releases the single-user lock file
    process.exit(0);
  });
}
