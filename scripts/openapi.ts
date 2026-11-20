// Writes docs/openapi.json from the schemas: npm run openapi
// The contract test fails if the committed file differs from what the code generates,
// so the published description can never drift from the API.
import { writeFileSync } from 'node:fs';
import { buildOpenApi } from '../src/api/openapi.js';

export const OPENAPI_FILE = new URL('../docs/openapi.json', import.meta.url);
export const render = () => JSON.stringify(buildOpenApi(), null, 2) + '\n';

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(OPENAPI_FILE, render());
  console.log('Wrote docs/openapi.json');
}
