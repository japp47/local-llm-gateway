import { z } from 'zod';
import type { ConversationListKey } from '../storage/index.js';
import { AppError } from './errors.js';

// Opaque to clients: they only pass back what they were given, so the format can change.
const Payload = z.object({ u: z.iso.datetime(), i: z.uuid() });

export function encodeListCursor(key: ConversationListKey): string {
  return Buffer.from(JSON.stringify({ u: key.updatedAt.toISOString(), i: key.id })).toString('base64url');
}

export function decodeListCursor(cursor: string): ConversationListKey {
  try {
    const p = Payload.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    return { updatedAt: new Date(p.u), id: p.i };
  } catch {
    throw new AppError(400, 'invalid_cursor', 'invalid cursor');
  }
}
