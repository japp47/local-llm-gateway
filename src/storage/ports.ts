// Storage ports: what services and routes may ask of storage. Each backend
// (Postgres today, SQLite for single-user mode) implements all of them, and the
// shared integration suite proves they behave the same.
import type {
  ApiKey,
  Conversation,
  ForkInput,
  ForkResult,
  Generation,
  Message,
  ModelStatsRow,
  NewConversation,
  NewGeneration,
  NewMessage,
  RecentGeneration,
  User,
} from './types.js';

export interface UsersStore {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  create(email: string): Promise<User>;
}

export interface ApiKeysStore {
  create(userId: string, keyHash: string, label?: string): Promise<ApiKey>;
  /** Looks up by hash only; revoked keys are never returned. */
  findActiveByHash(keyHash: string): Promise<{ id: string; userId: string } | null>;
  /** True if the key was active and is now revoked. */
  revoke(id: string): Promise<boolean>;
}

/** Every method that takes a userId is scoped by it: an id alone never grants access. */
export interface ConversationsStore {
  create(v: NewConversation): Promise<Conversation>;
  /** Copies history up to and including the anchor message, atomically. */
  fork(v: ForkInput): Promise<ForkResult>;
  get(userId: string, id: string): Promise<Conversation | null>;
  list(userId: string, limit: number, before?: Date): Promise<Conversation[]>;
  rename(userId: string, id: string, title: string): Promise<Conversation | null>;
  remove(userId: string, id: string): Promise<boolean>;
  /** Atomic compare-and-set: succeeds only if nobody holds an unexpired lease. */
  acquireLease(id: string, seconds: number): Promise<boolean>;
  releaseLease(id: string): Promise<void>;
  /** Bumps updated_at; sets the title only if it is still empty. */
  touch(id: string, titleCandidate: string): Promise<void>;
}

export interface MessagesStore {
  add(v: NewMessage): Promise<Message>;
  /** Newest `limit` messages, returned in chronological order. */
  listRecent(conversationId: string, limit: number): Promise<Message[]>;
  /** One page in chronological order after `afterSeq`; `hasMore` says if more exist. */
  listPage(
    conversationId: string,
    afterSeq?: number,
    limit?: number,
  ): Promise<{ rows: Message[]; hasMore: boolean }>;
  countAll(conversationId: string): Promise<number>;
}

export interface GenerationsStore {
  add(v: NewGeneration): Promise<Generation>;
  /** Per-model latency, throughput and token totals for one user since `since`. */
  statsByModel(userId: string, since: Date): Promise<ModelStatsRow[]>;
  /** Newest first. */
  recent(userId: string, limit: number, since?: Date): Promise<RecentGeneration[]>;
  /** Every generation of one user, oldest first. */
  listByUser(userId: string): Promise<Generation[]>;
}

export interface Storage {
  users: UsersStore;
  apiKeys: ApiKeysStore;
  conversations: ConversationsStore;
  messages: MessagesStore;
  generations: GenerationsStore;
  /** True if the backend answers a trivial query. Used by /readyz. */
  ping(): Promise<boolean>;
  /** Brings the schema up to date. */
  migrate(): Promise<void>;
  close(): Promise<void>;
}
