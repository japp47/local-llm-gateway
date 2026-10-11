import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { buildApp, type Deps } from '../src/app.js';
import { createConfig } from '../src/config.js';
import { createDb } from '../src/db/client.js';
import { generateApiKey, sha256 } from '../src/lib/hash.js';
import type { ChatEvent, ChatRequest, LLMProvider } from '../src/providers/types.js';

export const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://llmgw:llmgw@127.0.0.1:5432/llmgw_test';

export interface FakeScript {
  chunks: string[];
  failAfter?: number; // throw after emitting this many chunks
  usage?: { promptTokens: number; completionTokens: number };
}

/** Scriptable provider: records calls, can fail midway, and can be held open. */
export class FakeProvider implements LLMProvider {
  readonly name = 'fake';
  calls: ChatRequest[] = [];
  script: FakeScript = { chunks: ['Hello', ' world'] };
  started: Promise<void>;
  private markStarted!: () => void;
  private gate: Promise<void> | null = null;
  private openGate: (() => void) | null = null;

  constructor() {
    this.started = new Promise<void>((r) => (this.markStarted = r));
  }

  hold() {
    this.gate = new Promise<void>((r) => (this.openGate = r));
  }
  release() {
    this.openGate?.();
  }

  async *chat(req: ChatRequest): AsyncGenerator<ChatEvent> {
    this.calls.push(req);
    this.markStarted();
    if (this.gate) await this.gate;
    let i = 0;
    for (const text of this.script.chunks) {
      if (req.signal?.aborted) throw new Error('aborted');
      if (this.script.failAfter !== undefined && i >= this.script.failAfter) throw new Error('boom');
      yield { type: 'delta', text };
      i++;
    }
    if (this.script.usage) yield { type: 'usage', ...this.script.usage };
    yield { type: 'done', finishReason: 'stop' };
  }
}

let migrated = false;

export async function makeTestApp(
  provider?: LLMProvider,
  env: Record<string, string> = {},
) {
  const database = createDb(TEST_DB_URL);
  if (!migrated) {
    await migrate(database.db, { migrationsFolder: './drizzle' });
    migrated = true;
  }
  await database.db.execute(
    sql`truncate table generations, messages, conversations, api_keys, users restart identity cascade`,
  );

  const config = createConfig({
    DATABASE_URL: TEST_DB_URL,
    LOG_LEVEL: 'silent',
    ALLOWED_MODELS: 'fake-model,other-model',
    DEFAULT_MODEL: 'fake-model',
    ...env,
  });
  const { app, deps } = await buildApp({ config, provider, database });

  return {
    app,
    deps,
    addUser: (email: string) => addUser(deps, email),
    close: async () => {
      await app.close();
      await database.close();
    },
  };
}

export async function addUser(deps: Deps, email: string) {
  const user = await deps.repos.users.create(email);
  const key = generateApiKey();
  await deps.repos.apiKeys.create(user.id, sha256(key));
  return { userId: user.id, key, headers: { authorization: `Bearer ${key}` } };
}

export function parseSse(payload: string) {
  return payload
    .split('\n\n')
    .filter((b) => b.trim())
    .map((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1] ?? '';
      const data = /^data: (.+)$/m.exec(block)?.[1];
      return { event, data: data ? (JSON.parse(data) as Record<string, any>) : {} };
    });
}

export async function waitFor(cond: () => boolean | Promise<boolean>, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('waitFor timed out');
}
