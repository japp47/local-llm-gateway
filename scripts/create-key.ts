import { createConfig } from '../src/config.js';
import { createDb } from '../src/db/client.js';
import { generateApiKey, sha256 } from '../src/lib/hash.js';
import { ApiKeysRepo, UsersRepo } from '../src/repositories/identity.js';

const email = process.argv[2];
if (!email) {
  console.error('usage: npm run key:create -- you@example.com [label]');
  process.exit(1);
}

const { db, close } = createDb(createConfig().DATABASE_URL);
const users = new UsersRepo(db);
const keys = new ApiKeysRepo(db);

const user = (await users.findByEmail(email)) ?? (await users.create(email));
const raw = generateApiKey();
await keys.create(user.id, sha256(raw), process.argv[3]);
await close();

console.log(`user:    ${user.email} (${user.id})`);
console.log(`api key: ${raw}`);
console.log('Store this key now. Only its hash is saved, so it cannot be shown again.');