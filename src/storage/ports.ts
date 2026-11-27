// Storage ports: what services and routes may ask of storage. Each backend
// (Postgres today, SQLite for single-user mode) implements all of them, and the
// shared integration suite proves they behave the same.
import type {
  ApiKey,
  Conversation,
  ConversationListKey,
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
  /** All keys of one user, revoked ones included, oldest first. */
  listForUser(userId: string): Promise<ApiKey[]>;
}

/** Every method that takes a userId is scoped by it: an id alone never grants access. */
export interface ConversationsStore {
  create(v: NewConversation): Promise<Conversation>;
  /** Copies history up to and including the anchor message, atomically. */
  fork(v: ForkInput): Promise<ForkResult>;
  get(userId: string, id: string): Promise<Conversation | null>;
  /** Most recently updated first; with `after`, only conversations that sort after that key. */
  list(userId: string, limit: number, after?: ConversationListKey): Promise<Conversation[]>;
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

/**
 * Browser sign-in. Only hashes are stored. Times come from the caller (one clock per
 * request), so expiry is decided the same way on both backends.
 */
export type CodePurpose = 'open' | 'pair';
export type SessionOrigin = 'local' | 'network';

export interface WebSessionInfo {
  id: string;
  deviceName: string | null;
  createdFrom: SessionOrigin;
  createdAt: Date;
  lastSeenAt: Date;
}

/**
 * Browser sign-in. Only hashes are stored. Times come from the caller (one clock per
 * request), so expiry is decided the same way on both backends.
 */
export interface WebSessionsStore {
  createCode(userId: string, codeHash: string, expiresAt: Date, purpose: CodePurpose): Promise<void>;
  /** Marks the code used and returns its user and purpose, atomically: a code works once, before it expires. */
  redeemCode(codeHash: string, now: Date): Promise<{ userId: string; purpose: CodePurpose } | null>;
  createSession(
    userId: string,
    tokenHash: string,
    now: Date,
    expiresAt: Date,
    device: { name: string | null; createdFrom: SessionOrigin },
  ): Promise<{ id: string }>;
  /** A session that is not revoked and not expired at `now`. */
  findActiveSession(
    tokenHash: string,
    now: Date,
  ): Promise<{ id: string; userId: string; lastSeenAt: Date; createdFrom: SessionOrigin } | null>;
  /** Records use and moves the idle expiry forward. */
  touchSession(id: string, now: Date, expiresAt: Date): Promise<void>;
  /** True if the session was active and is now revoked. */
  revokeSession(tokenHash: string, now: Date): Promise<boolean>;
  /** The user's active sessions (their signed-in devices), most recently used first. */
  listSessions(userId: string, now: Date): Promise<WebSessionInfo[]>;
  /** Revokes one of the user's sessions by id; false if not theirs, not found or already ended. */
  revokeSessionById(userId: string, id: string, now: Date): Promise<boolean>;
  /** Removes codes and sessions that ended before `before` (housekeeping). */
  deleteExpired(before: Date): Promise<void>;
}

export interface Storage {
  users: UsersStore;
  apiKeys: ApiKeysStore;
  webSessions: WebSessionsStore;
  conversations: ConversationsStore;
  messages: MessagesStore;
  generations: GenerationsStore;
  /** True if the backend answers a trivial query. Used by /readyz. */
  ping(): Promise<boolean>;
  /** Brings the schema up to date. */
  migrate(): Promise<void>;
  /** How many migrations ran, and how many this build ships. For `llm doctor`. */
  migrationStatus(): Promise<{ applied: number; available: number }>;
  /**
   * Copies the live database to `dest`, consistent even while requests run. SQLite only:
   * a shared Postgres database is backed up with Postgres's own tools (pg_dump).
   */
  backup?(dest: string): Promise<void>;
  close(): Promise<void>;
}
