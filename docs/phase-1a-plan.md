# Phase 1a plan: single-user engine

Goal: on a machine with only Node and Ollama, one command starts the gateway and
`llm chat` works without setting up keys. The same API test suite passes on the
single-user backend and on Postgres + Redis.

Status: plan, nothing built yet. Written 2026-10-11 from a read of the code at `b07c349`.

---

## 1. What the code looks like today (findings)

How storage is coupled:

| Place | Coupling | Impact |
| --- | --- | --- |
| `src/db/client.ts` | `Db` = drizzle **postgres-js** type, exported everywhere | Every repo, `Deps`, tests depend on the Postgres driver type |
| `src/db/schema.ts` | `pgTable`, `uuid().defaultRandom()`, `bigserial`, `timestamptz` | A SQLite schema must be a second file (`sqliteTable`) |
| `repositories/*.ts` | Concrete classes over `Db`; types from `$inferSelect` of the pg schema | No interface to swap; domain types leak from the pg schema |
| `ConversationsRepo.fork` | `.for('share')` row locks inside an async transaction | SQLite has no row locks |
| `ConversationsRepo.acquireLease` | `now() + make_interval(secs => …)` | Postgres-only function, DB clock |
| `GenerationsRepo.statsByModel` | `percentile_cont`, `filter (where …)`, `::float8` casts | Rewrite or compute in code |
| `routes/health.ts` | `deps.db.execute(sql\`select 1\`)` | Route talks to the driver directly |
| `app.ts` `Deps.db` | Raw DB handle exposed to routes | Should become `storage.ping()` |
| `test/*.int.test.ts` | `t.deps.db.select().from(generations)`, `db.update(apiKeys)` | The shared suite can't use drizzle tables directly |
| `test/helpers.ts` | `truncate … restart identity cascade`, pg migrator | Needs a per-backend reset |
| `config.ts` | `DATABASE_URL: z.string().min(1)` (required) | Must become optional |
| `package.json` `start`/`dev` | `--env-file=.env` | Node exits if `.env` is missing; use `--env-file-if-exists` |

Already in place, so it costs little:
- **In-process rate limiting already works.** `@fastify/rate-limit` uses its in-memory
  LRU store when no `redis` is passed, and `app.ts` only passes Redis when `REDIS_URL` is
  set. It still needs a test.
- The Semaphore (admission control) is in-process in both modes.
- `buildApp({ config, provider, database })` is a real composition root, so swapping
  adapters happens in one place.
- Node 26 ships `node:sqlite` (SQLite 3.53 confirmed locally). drizzle 0.45 ships drivers
  for `better-sqlite3`, `libsql`, `pglite` and `sqlite-proxy`, but none for `node:sqlite`.

**Bug found:** `package.json` runs `vitest run -c vitest.int.config.ts`, but the file is
`vitest.config.int.ts`. `npm run test:int` fails at startup ("failed to load config"),
so CI's integration step is red or never ran. Fix this first (step 0).

---

## 2. Design principles for this work

1. **Ports and adapters.** Services depend on interfaces (ports). Postgres and SQLite are
   adapters. Only the composition root (`createStorage(config)`) knows which one runs.
   *Why:* features are written once, and the mode is a deployment detail.
2. **The contract is the test suite, not the interface.** TypeScript checks shapes. Only a
   shared suite run against both adapters proves the same *behaviour*: ordering, cascades,
   lease semantics, percentile maths, null handling.
3. **Domain types belong to the port, not the ORM.** `Conversation`, `Message` and
   `Generation` are plain TS types in `src/storage/types.ts`, and both adapters map to them.
   *Why:* otherwise the pg schema's `$inferSelect` decides the contract.
4. **Keep atomicity in the storage layer.** Lease compare-and-set and fork copy stay single
   storage calls. Each adapter uses its own engine's tools (row locks vs `BEGIN IMMEDIATE`).
   Services never get a "transaction" abstraction. *Why:* a leaky transaction abstraction
   across two engines is where dual-backend projects rot.
5. **One clock where it matters.** Postgres uses `now()`. SQLite uses the app clock
   (`Date.now()`), which is safe because exactly one process owns the file. Write this
   down as an invariant: single-user mode = single process.
6. **Config chooses the mode, never the user.** `DATABASE_URL` → Postgres, else SQLite.
   `REDIS_URL` → Redis, else memory. Log the chosen mode once at startup.
7. **No auth bypass for "local".** Single-user mode still requires a key. The gateway
   creates it and hands it to the CLI through a 0600 file. *Why:* any local process, or a
   web page doing DNS rebinding or CSRF against `127.0.0.1`, could use a loopback bypass.
8. **Fail closed, explain plainly.** On startup, errors are sentences a non-technical user
   can act on ("Ollama is not running. Open the Ollama app and try again.").
9. **Small, always-green steps.** Each step below is one commit or PR with both suites green.
   The refactor (step 2) changes no behaviour before the new adapter exists.

---

## 3. The spike (timebox: about 1 to 2 hours)

Candidates:

| | A. SQLite via `better-sqlite3` | B. SQLite via `node:sqlite` | C. PGlite (Postgres in WASM) |
| --- | --- | --- | --- |
| Drizzle support | Native driver | Only through `sqlite-proxy` (async shim, weak transaction support) | Native driver (`drizzle-orm/pglite`) |
| SQL dialect | Second schema + migrations | Same as A | **Same schema, same migrations, likely same repos** |
| Native addon | Yes (prebuilds per Node ABI) | None | None (WASM) |
| Maturity for user data | Very high | Engine high, Node binding newer | Younger; data dir tied to PGlite version |
| Transactions | Synchronous only (async callbacks inside are a known trap) | Manual `BEGIN`/`COMMIT` | Async, like today |

Questions the spike must answer, with numbers:
1. **Effort:** with C, does the existing integration suite pass unchanged, with only
   `createDb` swapped? With A, how many repo methods need a rewrite? (Estimate: all of them
   get a second implementation, three of them non-trivial.)
2. **Durability:** `kill -9` during a write loop, then reopen. Any corruption, any lost
   committed rows?
3. **Cold start and memory:** time to open the DB and run migrations; RSS after open.
   (16 GB Air: the model needs the memory, not the gateway.)
4. **Packaging:** does `better-sqlite3` have a prebuild for Node 26 on darwin-arm64?
   Does it survive bundling into the future app shell?
5. **Upgrades:** what happens to a PGlite data dir after a PGlite version bump?
6. **Inspectability:** can a user or a support script open the data file with standard tools?

### Spike result (2026-10-11): **A, SQLite via better-sqlite3**

Measured on a MacBook Air M4 with Node 26.10, better-sqlite3 13.0.3, PGlite 0.5.8
(Postgres 18) and drizzle 0.45.3. The scripts lived in a scratchpad and were not committed.

| Measure | SQLite (better-sqlite3, WAL, sync=NORMAL) | PGlite (file data dir) |
| --- | --- | --- |
| Existing integration suite | n/a (needs the new adapter) | **38/38**, after one line: `db.execute` returns `{ rows }`, not an array |
| Open a new DB | 5–12 ms | 760–860 ms (runs initdb) |
| RSS after open + 2,000 inserts | **16 MB** | **816–897 MB** |
| RSS reopening an existing DB | ~16 MB | ~280–330 MB; a smaller `initialMemory` crashes |
| Inserts/s (one commit each) | ~100,000 | ~10,000 |
| Empty-ish DB on disk | 1 MB | 39 MB |
| `kill -9` mid-write, 5 rounds each | No acked row lost, `integrity_check` ok | No acked row lost |
| Install on Node 26 darwin-arm64 | Prebuilt N-API binary, no compile, ABI-stable across Node versions | Pure WASM |
| Inspect with standard tools | `sqlite3` CLI (ships with macOS) | Only the same PGlite/Postgres major |
| Upgrades | File format stable for decades | Data dir is Postgres 18 (`PG_VERSION`); a PGlite release on a new Postgres major needs dump/restore (not tested) |

Why A wins: the target is a 16 GB laptop whose RAM belongs to the model. A storage engine
that takes 0.3–0.9 GB to hold one person's chats is the wrong trade, however much code it
saves. PGlite's real win was effort, since it would skip most of steps 3 and 4. We pay that
cost instead, and get the interview story with it.

Not tested: power loss. `kill -9` is a process crash. With `synchronous=NORMAL` in WAL
mode, a power cut can lose the last few commits but not corrupt the file. Use `FULL` if
that ever matters more than write speed.

Option B (`node:sqlite`) was not pursued. drizzle 0.45 has no driver for it, and
better-sqlite3 13 already removed the native-build worry.

Steps 2 and 3 (ports and shared suite) happen as planned. The rest of this plan assumes A.

---

## 4. Implementation steps

### Step 0: Hygiene (small, first)
- Fix the `test:int` script so it points at `vitest.config.int.ts`, and confirm CI goes green.
- Switch `dev` and `start` to `--env-file-if-exists=.env`.
- Commit: `fix: point test:int at the integration vitest config`.

### Step 1: Spike (section 3)
- Throwaway branch. Output: a short note in the roadmap and a decision.

### Step 2: Storage ports, Postgres adapter only (no behaviour change)
- New `src/storage/`:
  - `types.ts`: domain types (`User`, `ApiKey`, `Conversation`, `Message`, `Generation`,
    `ModelStatsRow`, `ForkResult`).
  - `ports.ts`: `UsersStore`, `ApiKeysStore`, `ConversationsStore`, `MessagesStore`,
    `GenerationsStore`, and an aggregate
    `Storage { users; apiKeys; conversations; messages; generations; ping(); close(); migrate() }`.
  - `postgres/`: move the current repos here unchanged, typed against the ports. Move
    `schema.ts` to `postgres/schema.ts`. Update the `drizzle.config.ts` path.
  - `index.ts`: `createStorage(config): Promise<Storage>`.
- `app.ts`: `BuildOptions.database` becomes `storage`. Drop `Deps.db`. `/readyz` uses
  `storage.ping()`. `ModelsRepo` is not storage and stays where it is.
- Ports gain the methods tests need in place of raw SQL: `apiKeys.revoke(id)` (needed for
  key management in Phase 2 anyway) and `generations.listByUser(userId)` or `byRequestId`.
- Replace `t.deps.db…` in tests with these methods.
- Done when: typecheck, unit and integration tests are green on Postgres. `git grep "deps.db"` is empty.
- Commit: `refactor: put storage behind repository interfaces`.

### Step 3: Shared contract suite
- `test/helpers.ts`: `makeTestApp` reads `TEST_BACKEND=postgres|sqlite`. Postgres keeps
  migrate + truncate. SQLite opens a fresh `:memory:` DB (or temp file) per app.
- Rename to make the split clear: `test/api/*.test.ts` (shared, both backends),
  `test/server/*.test.ts` (Postgres/Redis-only), `test/single/*.test.ts` (SQLite-only).
- New contract cases worth adding now, since they are where adapters diverge:
  - Message `seq` strictly increases across conversations; forks copy in order.
  - Deleting a conversation cascades messages and sets `generations.conversation_id` to null.
  - Lease: a second send gets 409, the lease expires after `LEASE_SECONDS` (set it to 1 in
    the test), and it is released on error.
  - Stats: a fixed set of TTFTs gives exact p50/p95 (for example `[100,200,300,400]` → p50 250,
    p95 385), and nulls are ignored.
  - Conversation list cursor (`before`) pages without skips or duplicates.
  - The in-memory rate limiter returns 429 after `RATE_LIMIT_MAX` with no Redis.
- Scripts: `test:int` (Postgres), `test:sqlite`, `test:all`.
- Done when: the suite is green on Postgres. The SQLite run is expected to fail until step 4.

Done 2026-10-11, with two changes from the plan above:
- **No folder split yet.** All integration tests are shared, since none is mode-specific
  today. `TEST_BACKEND` is read in `test/helpers.ts`; mode-only tests can use
  `describe.runIf(TEST_BACKEND === …)` or a folder when the first one appears. The
  SQLite scripts arrive with the adapter in step 4.
- **The contract tests found a real bug.** The conversation list cursor (`before` =
  `updated_at`) skipped rows. Postgres stores microseconds but JSON keeps only
  milliseconds, so any row in the same millisecond as the cursor was skipped (1 of 7 in
  the test). Fix: an opaque `cursor`/`nextCursor` holding `(updatedAt, id)`, keyset
  `WHERE (updated_at, id) < (…)`, and `updated_at` stored as `timestamptz(3)` (migration
  0002). Stats percentiles and the in-memory limiter were already covered by existing tests.

### Step 4: SQLite adapter
- `src/storage/sqlite/schema.ts` (`sqliteTable`), with its own drizzle config and migrations
  in `drizzle/sqlite/`. Type mapping:
  - `uuid` → `text`, with ids from `crypto.randomUUID()` in app code.
  - `timestamptz` → `integer({ mode: 'timestamp_ms' })`. Values are sortable and comparable,
    and come back as `Date`, so API JSON is identical.
  - `messages.seq bigserial` → `seq INTEGER PRIMARY KEY AUTOINCREMENT`, with `id TEXT UNIQUE`.
    This gives a monotonic seq with no max+1 race.
- Connection pragmas on open: `journal_mode=WAL`, `foreign_keys=ON` (**off by default**,
  and cascades depend on it), `busy_timeout=5000`, `synchronous=NORMAL`.
- Rewrites:
  - `acquireLease`: one `UPDATE … SET lease_until = :now+ms WHERE id = :id AND
    (lease_until IS NULL OR lease_until < :now) RETURNING id`. It stays an atomic
    compare-and-set because SQLite serialises writers.
  - `fork`: a synchronous `BEGIN IMMEDIATE` transaction (take the write lock up front, which
    replaces `FOR SHARE`). With better-sqlite3 the callback must not `await`.
  - `statsByModel`: select the window's rows, then group and compute in code. Put
    `percentileCont(sorted, p)` in `src/lib/stats.ts` (linear interpolation, matching
    Postgres) with its own unit tests. Trade-off: O(rows) in JS. That is fine for one
    person's history, and server mode keeps SQL.
  - `touch`: `coalesce` works as is.
- Migration upgrade test (roadmap 6a): for each backend, migrate to the oldest version,
  insert data, upgrade to the latest, and check nothing was lost.
- CI: add the `sqlite` job here, not in step 8, so the backends cannot drift from the
  moment the second one exists.
- Done when: the shared suite is green on both backends, locally and in CI.
- Commit: `feat: add SQLite storage adapter for single-user mode`.

Done 2026-10-13. 45 integration tests green on both backends; SQLite run takes ~5 s with
no services. Notes:
- Timestamps and ids are made in app code (`$defaultFn`), not by SQL defaults.
- Fork copies history in chunks of 500 rows (bound-parameter limit).
- Migrations are found by walking up to `drizzle/` (`storage/migrations-path.ts`).
- Found and fixed: `npm start` and the Dockerfile ran `dist/server.js`, but the build
  writes `dist/src/server.js` (`rootDir: "."`), so neither could start.

### Step 5: Mode selection, data folder, migrations at boot
- `config.ts`: `DATABASE_URL` optional. Add `DATA_DIR`, defaulting to
  `~/Library/Application Support/llm-gateway` on macOS and `$XDG_DATA_HOME/llm-gateway`
  elsewhere. Add a derived `mode: 'single' | 'server'`.
- Single-user mode: create the folder (0700), open `gateway.db`, and run migrations
  automatically on startup. Server mode keeps `npm run db:migrate`. Auto-migrating a shared
  database is a separate decision.
- Guard against two gateways on one file: take a lockfile or bind the port first, and
  exit with a plain message if one is already running.
- Log one startup line: `mode=single storage=sqlite path=… ratelimit=memory`.
- Commit: `feat: choose storage and rate limiter from config`.

Done 2026-10-13. `openStorage(config)` replaces `createStorage`. Empty `DATABASE_URL` /
`REDIS_URL` count as unset (`npm run dev:single`). Lock file `gateway.lock` holds the PID;
a live owner gives a plain-language refusal, a dead one is taken over (tested against a
real second process). `listen` failures close storage first, so no lock is left behind.
Single-mode tests live in the unit suite (`test/single-mode.test.ts`): no services.

### Step 6: Zero-config identity and CLI auto-configuration
- Single-user first run: if no user exists, create `local@localhost` and a key. Write
  `{ baseUrl, apiKey }` to `DATA_DIR/local-credentials.json` (0600, atomic write, the
  same pattern as `cli/src/config.ts`). Only the hash goes in the database, as today.
  If the file is lost, the next start rotates the key: revoke the old one and issue a new one.
- CLI: when no key is configured and the effective base URL **equals** the `baseUrl` in
  that file, use the key from the file. Otherwise never send it. This keeps the rule
  "never send a saved key to a gateway it was not saved for". Explicit config and env
  still win.
- Server mode is unchanged: keys come from `npm run key:create`.
- Tests: the CLI unit tests cover the credential-file logic (match, mismatch, missing,
  bad permissions). The single-only suite covers first-run creation and idempotent restarts.
- Commit: `feat: create a local key on first run and let the CLI find it`.

Done 2026-10-14. File: `DATA_DIR/local-credentials.json` (0600, atomic), user
`local@localhost`, key label `local (auto)`; a lost or damaged file rotates the key (old
one revoked). CLI: last-resort key source in `loadConfig`, only for loopback URLs with the
same scheme and port (localhost = 127.0.0.1 = ::1); ignored with a reason if the file is
group/world-readable or owned by someone else; shown in `llm config show`. CLI tests run
with HOME pointed at a nonexistent folder so they never read a real key.
Finding for step 7: with Ollama stopped, `llm chat` shows "generation failed
(internal_error)" because the provider's `fetch failed` is not classified. It should say
"Ollama is not running. Open the Ollama app and try again." (and /readyz already knows).

### Step 7: Model auto-pick and plain-language startup errors
- `src/services/model-picker.ts`: inputs are `os.totalmem()` and Ollama `/api/tags`
  (name, size). Pick the largest installed model whose size is at most about 50% of RAM,
  preferring a known-good list. It is a pure function with a table-driven unit test.
- In single-user mode, allowed models = installed models (unless `ALLOWED_MODELS` is set),
  and the default = the auto-pick (unless `DEFAULT_MODEL` is set). Server mode keeps the env list.
- Startup checks with plain messages: Ollama not reachable, no models installed (with the
  exact `ollama pull …` command), data folder not writable, port in use.
- Commit: `feat: pick a default model that fits this machine`.

Done 2026-11-20. Choices: memory budget 50% of total RAM; a curated preference list
(`PREFERRED_MODELS`), else the largest that fits; errors gain an optional `hint`. Estimate =
file + KV cache (from `/api/show` architecture) + 256 MB, within 10% of the measured 2.55 GB
for llama3.2:3b. Also done here, from the research: one error classifier
(`providers/ollama-errors.ts`) with codes `ollama_unavailable`, `model_not_installed`,
`model_too_large`, `model_stopped`; the provider is opened before the user message is saved
and before HTTP 200, so those failures save nothing; a one-time `/api/ps` check warns about
CPU spill and context mismatch; startup warns and keeps running. Server mode is unchanged
when the model settings are unset (llama3.2:3b). Verified with real Ollama 0.35.1 and the
e2e script (138 passed, both modes). Not done: setting the context size (Phase 2).

### Step 7b: `llm doctor` and backup/restore (added by roadmap v3)
- `llm doctor`: Ollama running and reachable, chosen model installed, gateway port free or
  answering, database opens and is migrated, CLI config valid. Each failure says what to
  do next. Reuse the step 7 startup checks; it must work when the gateway is down.
- `llm backup` / `llm restore`: SQLite online backup (`db.backup()` in better-sqlite3),
  restored into a fresh data folder shows the same conversations. Server mode: `pg_dump`
  guidance. Round trip covered by a test.
- Commits: `feat: add llm doctor diagnostics`, `feat: add tested backup and restore`.

Done 2026-11-20. `llm doctor` (CLI) checks config, gateway (mode, or why it's down: lock
file tells a crash from another port), key (with the rejected-key diagnosis), then the
gateway's own `GET /v1/doctor`: Ollama, model and memory fit, database reachable and fully
migrated (`Storage.migrationStatus`). Startup logs the same checks (`services/doctor.ts`).
Backup lives in the gateway (decision A): `POST /v1/backup` → SQLite online backup into
`DATA_DIR/backups/gateway-<time>.db` (0600, single file, integrity-checked); `llm backup`
calls it. Restore needs the gateway stopped: `npm run restore -- <file>` takes the instance
lock, checks the file, moves the current database (with WAL files) to
`backups/before-restore-<time>.db`, never deletes. `llm restore` prints the steps. Server
mode: both point to pg_dump / pg_restore. Round trip tested in the unit suite and in
`scripts/e2e.sh` (153 passed, both modes).

### Step 7c: OpenAPI from zod (added by roadmap v3, independent)
- Generate the spec from the route zod schemas and test responses against it in CI.
- Commit: `feat: generate OpenAPI from the request schemas`.

Done 2026-11-20. Every request AND response shape now lives in `src/api/schemas.ts` (routes
validate with it; responses are strict objects), every endpoint in `src/api/endpoints.ts`.
`src/api/openapi.ts` builds OpenAPI 3.1 with zod 4's own JSON Schema output (no converter
library); SSE events are documented under `x-sse-events`. Served at `GET /openapi.json`,
committed as `docs/openapi.json` (`npm run openapi`). `test/contract.int.test.ts` (both
backends, in CI) validates real responses against the document with ajv, checks every
registered route is documented and vice versa, that every documented success response is
produced by a test, that $refs resolve, and that `docs/openapi.json` is current. Unknown
URLs now return the standard error shape (`not_found`).

### Step 8: CI, docs, gate walk
- CI: a `server` job with a Redis service, for Redis-only behaviour (the `sqlite` job
  arrived in step 4). CLI checks stay.
- Update README quickstart ("install Node and Ollama, `npm start`"), CLAUDE.md
  (commands, modes), and roadmap (spike result, known limitations).
- Gate walk by hand: on a clean user account with Node and Ollama only, run
  `npm ci && npm run build && npm start`, then `llm chat`. Then repeat in server mode with Docker.
  The gate also needs `llm doctor` to explain "Ollama not running" and "model missing", and
  a backup restored into a fresh data folder to show the same conversations.

Done 2026-11-20. CI: the Postgres job became `server` with a Redis service and
`test/redis.int.test.ts` (shared limit across instances, per-key counting, serving on with
Redis down). README opens with the Node + Ollama quick start; roadmap and CLAUDE.md
refreshed. **Gate walk passed** (`docs/gate-walk.md`, same-account variant: fresh clone,
separate `DATA_DIR`, `XDG_CONFIG_HOME` and port): first answer with no key setup, answer
within seconds; history survives a restart; `llm doctor` explained Ollama not running,
model missing and gateway down; a backup restored into a fresh folder showed the same
conversations. Not covered by this variant: a first model download and permissions in a
second macOS account (`npm install -g`); both belong to the Phase 1b installer.

---

## 5. Risks and how they're covered

| Risk | Mitigation |
| --- | --- |
| Adapters drift apart | Shared suite in CI on both; schema column-parity test |
| Two schemas, two migration histories | Every schema PR updates both; the parity test fails otherwise |
| SQLite `foreign_keys` off by default, so cascades silently don't happen | Pragma at open, plus a cascade contract test |
| Sync better-sqlite3 blocks the event loop | Queries are tiny; stats are bounded by the window; measure in the spike |
| Two processes on one SQLite file break the lease/clock invariant | Lockfile; documented single-process invariant |
| Native addon fails on the user's Node | Spike checks prebuilds; the app shell pins its own Node in 1b |
| Plaintext key file | Same trust level as the existing 0600 CLI config; keychain later |

## 6. Interview story (why this is a good one)

"I put a storage port behind the repositories and ran one contract suite against two
adapters. I kept atomic operations (lease compare-and-set, fork copy) inside the adapter
and used each engine's own tools: row locks in Postgres, `BEGIN IMMEDIATE` and a
single-writer invariant in SQLite. Percentiles moved from SQL to a tested function that
matches `percentile_cont`. Mode selection is configuration only. I refused a loopback auth
bypass because of DNS rebinding."
