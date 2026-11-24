# local-llm-gateway

A local-first LLM gateway (Fastify + TypeScript) in front of Ollama, plus a CLI (`llm`).
It is both a backend/system-design learning project (the owner is preparing for
product-based and fintech roles) and the engine of a product meant for everyday,
non-technical users. Explain the "why" of design choices briefly; trade-offs matter here.

## Commands

Root (gateway):
- `npm run dev` (tsx watch, reads `.env`), `npm run dev:single` (same, but forces single-user
  mode: SQLite in `DATA_DIR`, no Docker), `npm run build`, `npm start`
- `npm run typecheck`, `npm test` (unit only, excludes `*.int.test.ts`)
- `npm run test:int` (integration; needs Postgres at `TEST_DATABASE_URL`, default
  `postgres://llmgw:llmgw@127.0.0.1:5432/llmgw_test`, and Redis at `TEST_REDIS_URL`, default
  `redis://127.0.0.1:6379`, for the Redis-only tests; it EMPTIES users, api_keys,
  conversations, messages, generations, so never point it at real data)
- `npm run test:int:sqlite`: the same suite on in-memory SQLite, no services needed
- `npm run db:generate` (generates Postgres AND SQLite migrations; schemas must change
  together) / `npm run db:migrate` (Postgres)
- `npm run key:create -- you@example.com [label]` prints a raw API key once
- `npm run openapi` regenerates `docs/openapi.json` (the contract test fails if it is stale)
- npm package (`docs/specs/npm-package.md`): the root package ships the gateway AND `llm`
  (`bin`: `llm`, `llm-gateway`; `files` allow-list; `prepack` builds both). `llm start` runs
  the gateway next to the CLI (`cli/src/gateway-files.ts`); `llm restore <file>` runs
  `dist/scripts/restore.js`. `npm run pack:smoke` packs, installs into a temp prefix and
  checks start/doctor/backup/restore (CI job `package`). `cli/.npmignore` exists so the
  built `cli/dist` is packed despite `cli/.gitignore`. Never `npm publish` without the owner.
- `npm run restore -- <file>`: restore a single-user backup (gateway stopped; with
  `DATABASE_URL` in `.env`, prefix `DATABASE_URL=`). `llm doctor`, `llm backup`.

CLI (`cli/`, separate package, binary `llm`):
- `npm ci && npm run build && npm test && npm run typecheck`
- Global install: build first, then `npm install -g .` (it symlinks the folder;
  rebuild after changes, no reinstall needed)

Local services: `docker compose up -d redis postgres`, Ollama on :11434,
`cp .env.example .env`, gateway on :3000.

Before saying a change is done: run typecheck and both test suites (root and `cli/`),
then list the files changed and how to test them by hand. Run the shared suite in both
modes (`test:int` and `test:int:sqlite`); `bash scripts/e2e.sh` for anything end to end.

## Architecture

- Composition root: `buildApp({ config, provider, storage })` in `src/app.ts`.
  Layers: `routes/` -> `services/` -> `storage/` ports (`ports.ts`, domain types in
  `types.ts`) -> adapters (`storage/postgres/`: Drizzle + postgres-js, schema, migrator).
  `storage/sqlite/` (better-sqlite3, migrations in `drizzle/sqlite/`) is the single-user
  adapter.
  `openStorage(config)` in `storage/index.ts` is the only place that picks a backend.
  Routes, services and tests never touch Drizzle directly (`deps.repos.*`, `deps.storage`).
  Models: `services/models.service.ts` (`deps.models`: `list`, `getDefault`, `check`).
  Both `ALLOWED_MODELS` and `DEFAULT_MODEL` set (server mode, tests): a fixed list.
  Otherwise (single-user): installed chat models from Ollama (cached 30 s, a miss
  re-checks), default from `services/model-picker.ts` (pure: file + KV cache + overhead
  must fit 50% of total RAM; curated `PREFERRED_MODELS`, else largest that fits).
  `plugins/` holds auth and metrics, `lib/` holds sse, semaphore, hash, tokens, cursor.
- Providers: `src/providers/types.ts` defines `LLMProvider { name; chat(req) }`.
  `chat` returns `Promise<AsyncIterable<delta | usage | done>>`: it resolves once the
  provider accepted the request (Ollama's headers come after the model loads) and rejects
  with a `ProviderError` whose `code` is `ollama_unavailable | model_not_installed |
  model_too_large | model_stopped | provider_error`. All classification and wording live in
  `providers/ollama-errors.ts`; `services/provider-errors.ts` maps codes to HTTP statuses.
  `providers/ollama-models.ts` reads `/api/tags`, `/api/show`, `/api/ps`. Only
  `OllamaProvider` exists. Tests use `FakeProvider` (`test/helpers.ts`; `script.refuse`
  makes it reject at open).
- Generation flow (`services/conversation.service.ts`): auth -> per-key rate limit
  (Redis, keyed by key id) -> model check -> conversation lease (one running answer per
  conversation, expires after `LEASE_SECONDS`) -> context builder (token budget, drops
  oldest) -> Semaphore admission control -> open provider stream -> save user message,
  reply 200 -> stream -> persist. A refusal at open is a plain HTTP error and saves
  nothing. The assistant message is saved after. If the connection drops after some
  text, it is saved with status `partial`. One `generations` row per started request
  records provider, model, TTFT (from opening, so it includes model load), queue wait,
  tokens, status. After the first complete answer per model, `/api/ps` is checked once
  and a warning is logged if the model spilled to the CPU or Ollama's context differs.
- Health checks (`services/doctor.ts`): Ollama, model and memory fit, database reachable
  and fully migrated (`Storage.migrationStatus`). Startup (`server.ts`) logs them and warns
  (never exits); `GET /v1/doctor` returns them for `llm doctor`, which adds CLI-side
  checks (config, gateway up and its mode, key) and works with the gateway down.
- Backup (`services/backup.ts`, single-user only): `POST /v1/backup` writes a checked
  SQLite online backup to `DATA_DIR/backups/` (0600); `llm backup` calls it. Restore runs
  with the gateway stopped (`npm run restore -- <file>`, takes the instance lock) and
  moves the replaced database aside, never deletes it. Server mode: pg_dump/pg_restore.
- SSE contract: `start` -> `delta`* -> `meta` -> `done`, or `error`. `meta` carries
  provider, model, token counts, timings, `contextUsed`, `contextBudget`, `droppedMessages`.
- Data: `users`, `api_keys` (SHA-256 hash only, `revokedAt`; revoked keys get 401),
  `conversations` (lease, parent/fork links), `messages` (`seq`, status
  complete|partial|error), `generations`.
- API under `/v1`: `me`, `models`, `model`, `stats`, `doctor`, `backup`, `conversations` (CRUD, messages,
  `POST /:id/forks`), transcript paging `GET /conversations/:id?after=&limit=` returning
  `messageCount` and `nextAfter`. The conversation list pages with an opaque cursor
  (`GET /conversations?limit=&cursor=` -> `nextCursor`), keyset on `(updated_at, id)`;
  `updated_at` is millisecond precision so the cursor is exact. Errors are
  `{ error: { code, message, hint? } }`: `code` is stable for programs, `message` is
  plain language, `hint` (optional) says what to do. SSE `error` events carry the same.
  Response fields are camelCase.
- API contract: all request/response shapes in `src/api/schemas.ts` (responses are strict
  objects), endpoints in `src/api/endpoints.ts`, OpenAPI 3.1 built by `src/api/openapi.ts`
  and served at `/openapi.json`. Adding or changing an endpoint: update both files, run
  `npm run openapi`; `test/contract.int.test.ts` checks real responses against the document
  and that every registered route is documented.
- Web chat (`docs/specs/web-chat.md`): React + Vite in `web/` (types imported from
  `src/api/schemas.ts`), built to `dist/web`, served at `/` + `/assets/*` by
  `routes/web-page.ts` with a strict CSP (no inline code). Model output is rendered by
  `web/src/markdown.tsx` as React elements, never HTML. `npm run dev:web` (Vite on :5173,
  proxy keeps Host/Origin). Browser sign-in: `llm open` -> `POST /v1/web/codes` (API key
  only) -> `/#code=` -> `POST /web/session` sets an HttpOnly SameSite=Strict cookie
  (`web_codes`/`web_sessions` tables, hashes only, `services/web-session.service.ts`). The
  auth hook accepts a Bearer key or the cookie; cookie requests must pass the Host check
  (loopback or `WEB_HOSTS`) and, when they change state, the Origin check
  (`plugins/web-guard.ts`). Tests pass `webRoot` = `test/fixtures/web`.
- CLI: `cli/src/config.ts` (profiles and precedence: env > active profile > legacy flat
  keys), `commands/`, `api/client.ts`. Config file path: `llm config path`.

## Run modes (one app, two modes)

- Single-user mode (default): SQLite `gateway.db` in `DATA_DIR` (default
  `~/Library/Application Support/llm-gateway`, 0700), created and migrated on startup,
  in-memory rate limiter; needs only Node and Ollama. `gateway.lock` (PID, like
  postmaster.pid) allows one gateway per data folder; a dead owner's lock is taken over.
  First start creates user `local@localhost` and writes `local-credentials.json` (0600);
  the CLI uses that key only when no key is configured and the URL is the same local
  gateway (`cli/src/local-credentials.ts`). Server mode: Postgres + Redis
  (+ optional Prometheus) via Docker, for households and teams.
- Chosen by config only: `DATABASE_URL` set -> Postgres, else SQLite; `REDIS_URL` set ->
  Redis limiter, else in-memory. Never ask the user to pick a mode.
- Routes, services and features are shared; only adapters differ (repository interfaces,
  rate-limit store). Admission control stays in-process in both.
- Testing: one shared API suite runs in CI against both modes; check each feature by hand
  in both; walk each phase gate end to end in both. Mode-specific features (key
  management, budgets: server; installer, zero-config: single-user) are tested only in
  their mode. Details: `docs/product-roadmap-3.md` section 3a.

## Conventions and gotchas

- ESM, TypeScript 7, zod 4, vitest 5, Fastify 5. Import local files with the `.js` suffix.
- Raw SQL via `db.execute(sql...)`: do not pass a JS `Date`; pass
  `date.toISOString()` with `::timestamptz`.
- Integration tests share one database, so `fileParallelism` is off. They are the shared
  API suite; `TEST_BACKEND` (default `postgres`) picks the storage in `test/helpers.ts`.
  `test/storage-contract.int.test.ts` holds cases where adapters tend to diverge.
- A CLI profile is local config (name, base URL, key, model). An API key is a server-side
  object. Do NOT add a `profiles` table.
- Never send a saved key to a gateway it was not saved for. Keys come from a hidden
  prompt or `--api-key-stdin`; `--api-key` only warns.
- Engineering standards (roadmap section 6a): zod at every boundary, OpenAPI contract
  tests, migration upgrade tests, tested backups, a fixed prompt set for regressions. Add
  no new infrastructure (vector DB, job system, search cluster, orchestration framework)
  without a feature in the current phase that needs it.
- Never commit `.env`. Do not ship `node_modules`, `dist`, `.git` in deliverables.
- Commit messages: Conventional style (`feat:`, `fix:`, `test:`), describing the feature,
  never "Phase N" in the subject.
- Do what was asked in the current message. Do not resume old threads on your own.

## Product direction (decisions already made)

- Everyday users come first; developer tools (CLI, API, keys, stats) are the opt-in
  power layer. Target hardware: MacBook Air M4, 16 GB.
- Full detail: `docs/product-roadmap-3.md`; step-by-step 1a plan: `docs/phase-1a-plan.md`. Read it when planning; it is deliberately not
  imported here to keep this file small.
- Wedge NOT decided yet (roadmap section 1a): A personal workspace, B private AI box for
  small offices (reuses server mode), C hybrid routing for developers. Five interviews
  (`docs/interview-guide.md`) decide it before Phase 1b. Phase 1a is needed for all three.
- Decided: app shape is a local web app served by the gateway first; Tauri/Electron later.
- Do not sell server mode on gateway features: LiteLLM already has keys, budgets and rate
  limits. For Phase 2b, evaluate LiteLLM as one adapter behind `LLMProvider`.

Phases:
- 0 Stabilize: DONE (CLI credential safety, transcript paging, `/v1/stats`, integration
  tests, CI runs CLI checks).
- 1 One-click app (IN PROGRESS: 1a DONE, gate passed 2026-11-20). Next, in order and not
  waiting for the wedge: npm package (done, 0.1.x), web chat page (done, 0.2.0), phone
  access v1 next (moved up from Phase 5).
  Surveys point to wedge B (small professional firms); interviews with CAs to confirm. 1a single-user engine: SQLite (better-sqlite3, decided by spike) and in-process rate
  limiting instead of Postgres/Redis, zero-config first run, model auto-picked by RAM,
  `llm doctor` diagnostics, tested `llm backup`/`llm restore`, OpenAPI from zod schemas,
  a migration upgrade test. 1b (after the wedge decision): installer and local web chat.
  Done when a first answer arrives within 5 minutes of opening the installer, no terminal.
- 2 Everyday assistants: assistant gallery (Modelfile recipes behind cards), fork UI
  ("Try another way"), chat search, a Trust & Privacy Center, keychain storage for CLI
  keys, session recovery (checkpoint a
  `streaming` assistant row every few seconds, mark stale ones `partial` on startup,
  then Retry and Continue), export/import/pin/archive (idempotent import), key
  management (`llm keys`, `api_keys.last_used_at` updated at most once a minute, from
  the auth hook, `GET /v1/me/api-key` in camelCase without `revokedAt`;
  `llm profile list --check` is opt-in, parallel, with timeouts).
- 2b (proposed): privacy modes Private / Balanced / Best quality, enforced server-side,
  failing closed (Private never falls back to cloud). Automation may only move toward
  more private. Provider registry mapping model -> provider and local/cloud; Anthropic
  and OpenAI-compatible providers; provider keys held server-side only; `meta` reports
  which provider actually answered so the badge reflects facts.
- 3 Documents, memory, voice. 4 Faster (speculative decoding; MLX once it fits 16 GB).
  5 Tools via MCP with permission prompts and an audit log, household mode.

Open decisions: the wedge; Phase 1a before the API-key feature (recommended); macOS only
first; whether cloud providers are supported at all; where 2b sits relative to Phase 3. Full list: roadmap section 12.

## Known limitations today

- Ollama only; in server mode, one global `ALLOWED_MODELS` list.
- The gateway can't set Ollama's context size (the OpenAI-compatible API has no `num_ctx`);
  it only warns on a mismatch. Fix planned with personas (Phase 2, native `/api/chat`).
- A cold first answer starts ~2 s later than before: the reply waits for Ollama to load
  the model, so failures are clean errors instead of a broken stream.
- A server crash mid-answer loses the in-flight text (the user message is kept).
- No export, import, search, archive or pin.
- CLI stores the API key in plaintext in a 0600 config file.
- No key create/revoke endpoints (keys come from `npm run key:create`).
- Default context window is 4096 tokens (`MODEL_CONTEXT_TOKENS`).