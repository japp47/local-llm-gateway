// Restore a single-user backup: npm run restore -- <backup file>
// Run it while the assistant is stopped. The current database is moved aside, never deleted.
import { resolve } from 'node:path';
import { createConfig } from '../src/config.js';
import { BackupError, restoreBackup } from '../src/services/backup.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run restore -- <backup file>\nBackups are in the data folder, under backups/ (see: llm backup).');
  process.exit(1);
}

try {
  const result = restoreBackup(createConfig(), resolve(file));
  console.log(`Restored ${result.conversations} conversations (${result.messages} messages).`);
  if (result.previous) console.log(`The database it replaced was kept at: ${result.previous}`);
  console.log('Start the assistant again: npm start');
} catch (err) {
  if (!(err instanceof BackupError)) throw err;
  console.error(err.message + (err.hint ? `\n  → ${err.hint}` : ''));
  process.exit(1);
}
