import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createConfig } from '../src/config.js';
import { createDb } from '../src/db/client.js';

const { db, close } = createDb(createConfig().DATABASE_URL);
await migrate(db, { migrationsFolder: './drizzle' });
await close();
console.log('migrations applied');