// Where the gateway lives relative to this CLI. In the repo and in the npm package the layout
// is the same: `cli/dist/` sits next to `dist/` (the built gateway), so one relative path
// works in both. A CLI copied somewhere on its own has no gateway next to it.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fromRoot = (rel: string) => fileURLToPath(new URL(`../../${rel}`, import.meta.url)); // this file: cli/dist/gateway-files.js

export const gatewayEntry = () => {
  const p = fromRoot('dist/src/server.js');
  return existsSync(p) ? p : null;
};

export const restoreEntry = () => {
  const p = fromRoot('dist/scripts/restore.js');
  return existsSync(p) ? p : null;
};

/** The command that starts the assistant, for messages: `llm start` when it can. */
export const startHint = () => (gatewayEntry() ? 'llm start' : 'npm start (in the gateway folder)');
