import { buildApp } from './app.js';
import { createConfig } from './config.js';

const config = createConfig();
const { app } = await buildApp({ config });
await app.listen({ host: config.HOST, port: config.PORT });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    app.log.info({ sig }, 'shutting down');
    await app.close();
    process.exit(0);
  });
}