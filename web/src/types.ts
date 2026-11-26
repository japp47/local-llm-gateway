// The page's view of the API, taken from the gateway's own schemas (src/api/schemas.ts), so
// the page and the server can't disagree about a field. Types only: no zod in the bundle.
import type { z } from 'zod';
import type * as S from '../../src/api/schemas';

export type Me = z.infer<typeof S.Me>;
export type ModelInfo = z.infer<typeof S.ModelInfo>;
export type ModelList = z.infer<typeof S.ModelList>;
export type Conversation = z.infer<typeof S.Conversation>;
export type ConversationPage = z.infer<typeof S.ConversationPage>;
export type ConversationWithMessages = z.infer<typeof S.ConversationWithMessages>;
export type ForkedConversation = z.infer<typeof S.ForkedConversation>;
export type Message = z.infer<typeof S.Message>;
export type MetaEvent = z.infer<typeof S.MetaEvent>;
export type BackupSummary = z.infer<typeof S.BackupSummary>;
export type Device = z.infer<typeof S.Device>;
export type DeviceList = z.infer<typeof S.DeviceList>;
export type PhoneInfo = z.infer<typeof S.PhoneInfo>;
