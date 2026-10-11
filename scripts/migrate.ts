import { createConfig } from '../src/config.js';
import { createStorage } from '../src/storage/index.js';

const storage = createStorage(createConfig());
await storage.migrate();
await storage.close();
console.log('migrations applied');
