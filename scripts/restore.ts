// Restore a single-user backup: `llm restore <file>`, or `npm run restore -- <file>` in the repo.
// Run it while the assistant is stopped. The current database is moved aside, never deleted.
// Built to dist/scripts/restore.js and shipped in the npm package (the CLI runs it).
import { resolve } from 'node:path';
import { createConfig } from '../src/config.js';
import { BackupError, restoreBackup } from '../src/services/backup.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: llm restore <backup file>\nBackups are in the data folder, under backups/ (see: llm backup).');
  process.exit(1);
}

try {
  const result = restoreBackup(createConfig(), resolve(file));
  console.log(`Restored ${result.conversations} conversations (${result.messages} messages).`);
  if (result.previous) console.log(`The database it replaced was kept at: ${result.previous}`);
  console.log('Start the assistant again: llm start  (or npm start in the repo)');
} catch (err) {
  if (!(err instanceof BackupError)) throw err;
  console.error(err.message + (err.hint ? `\n  → ${err.hint}` : ''));
  process.exit(1);
}
