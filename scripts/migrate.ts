import { createConfig } from '../src/config.js';
import { openStorage } from '../src/storage/index.js';

const storage = await openStorage(createConfig());
await storage.migrate();
await storage.close();
console.log('migrations applied');
