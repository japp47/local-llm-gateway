import { createHash, randomBytes } from 'node:crypto';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function generateApiKey(): string {
  return `llmgw_${randomBytes(32).toString('base64url')}`;
}