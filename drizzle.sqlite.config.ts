import { defineConfig } from 'drizzle-kit';

// Single-user mode. Postgres (server mode) uses drizzle.config.ts; `npm run db:generate`
// runs both so the two migration histories move together.
export default defineConfig({
  schema: './src/storage/sqlite/schema.ts',
  out: './drizzle/sqlite',
  dialect: 'sqlite',
});
