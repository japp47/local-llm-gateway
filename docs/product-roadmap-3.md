# Product and Development Roadmap

Last updated: 2026-10-13. Owner: Jappreet.

This is the single source of truth for what we are building, in what order, and why.
It merges two earlier documents, "Local LLM Platform: Product Research & Plan" and
"Product Phases, Unique Features and Future Bets" (both 7 Oct 2026). Where they disagreed,
section 4 records the decision that now holds.

How to use this file (for people and for Claude Code):
- `CLAUDE.md` is the short version that loads every session. Read this file when planning
  or starting a feature.
- Build one feature at a time, in phase order, unless the owner says otherwise.
- Every feature has a "Done when" line. Turn it into tests first.
- When a decision changes, update this file in the same change.

---

## 1. Vision and positioning

**Product:** a private AI assistant that runs on your own computer, which anyone can install
and use without knowing what a model is.

**Positioning:** a local AI workspace you can trust and return to. Conversations can be
branched, moved and recovered, and you can see where your data went. Open WebUI and
LM Studio already win on breadth, so we do not chase breadth.

**Two layers, one product:**
- *Everyday layer* (default, what success is judged by): one-step install, chat in
  minutes, nothing leaves the machine, plain words everywhere ("assistant", not
  "Modelfile"; "memory", not "context window").
- *Power layer* (opt-in, never required): CLI, HTTP API, profiles, keys, stats.

**Three tests every feature must pass.** If a feature fails all three, it is probably a
clone of something Open WebUI or LM Studio already does well.
1. Does it help someone *return* to work, not just chat once?
2. Does it make the system's behaviour *visible* (what ran, where, at what cost)?
3. Does it hold up when something *breaks* (model crash, laptop sleep, lost connection)?

**Target hardware:** MacBook Air M4, 16 GB. Every performance claim is measured there.

---

## 1a. Strategy check: which wedge (decision pending)

Market research from 12 Oct 2026 challenges the "everyday personal user" bet. Summary of
what holds, what needs proof, and what we do about it.

**Accepted findings**
- A generic "local LLM gateway on top of Ollama" is crowded. Forks and profiles alone are
  not a moat. Our edge must be the combination (branching, recovery, portability, visible
  privacy) plus an experience normal people can use, and that is still unproven.
- LiteLLM, an open-source gateway, already offers rate limits, budgets and key management.
  So server mode must not be sold on gateway features. Building them ourselves is still
  worth it for learning; for Phase 2b, consider LiteLLM as one adapter behind
  `LLMProvider` instead of writing every cloud provider ourselves.
- Ollama's server has no authentication by default, so exposing it on a network is unsafe.
  Our gateway already fixes that (hashed keys, per-key limits, per-user data).
- On 16 GB, model quality limits what normal users will accept. A shared office machine
  (for example a Mac mini with more memory) eases this.

**Candidate wedges**

| Wedge | Who pays or cares | Reuses | Changes to the roadmap if chosen |
| --- | --- | --- | --- |
| A. Personal private workspace (current plan) | Individuals | Single-user mode, Phase 2 features | None |
| B. Private AI box for a small office (CA firm, clinic, small legal or finance team) | Small businesses with confidential documents | Server mode (keys, limits, isolation), the "regulated small team" segment | Document search (Phase 3) and an audit log move earlier; the consumer installer matters less; bigger hardware |
| C. Hybrid routing and prompt debugging for developers | Developers | Forks, `generations`, provider interface | Phase 2b and "fork and replay" move earlier; competes with LiteLLM, OpenRouter and prompt-debugging tools |

**Needs research before acting**
- Whether small firms want wedge B at all, and what they would pay: answer with the five
  conversations in `docs/interview-guide.md`, not with articles.
- India's data-protection law (DPDP Act) as a selling point for wedge B: check its current
  status and actual obligations before using it in a pitch.
- Fork and replay for prompt debugging (wedge C): check existing prompt-debugging tools
  before treating it as unique.
- Market size numbers (Ollama usage figures that contradict each other; an analyst
  forecast that "AI PCs" reach about 55% of PCs in 2026) do not drive decisions. An
  "AI PC" means a machine with an NPU, not one that runs a good LLM.
- Several sources behind these findings are vendor or content-farm blogs; treat them as
  weak evidence.

**Plan:** keep building Phase 1a (needed for every wedge). In parallel, run the five
interviews. Choose the wedge before Phase 1b and before ordering Phase 2.

---

## 2. Users

All segments are hypotheses from competitor research, not interviews. Talk to real people
before building heavily for any of them.

| Segment | Job to be done | What makes them switch |
| --- | --- | --- |
| Everyday non-technical user (primary for the product) | "Help me with writing, study and questions, privately, without setup" | One-click install, plain words, visible privacy |
| Privacy-minded developer (primary for the power layer) | "Ask about my code and designs without it leaving my laptop" | Local-only guarantee, personas tuned to their stack |
| Small team in a regulated space (fintech, health, legal) | "Give five people one in-house model with limits and a record of use" | Per-person keys, token budgets, usage view, audit trail |
| Researcher or writer with long threads | "Explore two directions from one point, come back next week" | Branching, search, export, tree view |
| Scripter or automation builder | "Pipe text through a model in a shell script or CI job" | Stable one-shot mode, JSON output, exit codes, personas |
| Learner building a portfolio | "Show me how a real LLM backend works end to end" | Readable code, an inspector showing what was sent |

---

## 3. Where we are (after Phase 0)

### Built

Gateway (Fastify, TypeScript, Postgres via Drizzle, Redis):
- Conversations with SSE streaming: `start` -> `delta`* -> `meta` -> `done` | `error`.
- Hashed API keys (SHA-256), per-key rate limit (Redis), admission control with a bounded
  queue (Semaphore), a per-conversation lease (one running answer at a time).
- A `generations` table with per-request provider, model, tokens, queue wait, TTFT,
  generation time and status.
- Forks: copy history up to a message into a new conversation, keeping parent and
  anchor links. A fork survives the deletion of its parent, and the links are cleared.
- Partial answers: if the connection drops or the model fails after some text, that
  text is saved with status `partial`.
- `meta` event reports `contextUsed`, `contextBudget`, `droppedMessages`.
- Endpoints (`/v1`): `GET /me`, `GET /models`, `GET /model`, `GET /stats`,
  `POST /conversations`, `GET /conversations`, `GET /conversations/:id?after=&limit=`
  (paged, with `messageCount`, `nextAfter`), `PATCH` and `DELETE /conversations/:id`,
  `POST /conversations/:id/messages` (SSE), `POST /conversations/:id/forks`.
  Also a legacy stateless `POST /v1/chat/completions` passthrough, plus `/healthz`,
  `/readyz`, `/metrics` (Prometheus).

CLI (`llm`):
- `chat`, `resume`, `conversations` (`ls`), `show`, `fork`, `rename`, `rm`, `models`,
  `stats`, `whoami`, `profile add|use|list|current|remove`, `config set|show|path`.
- REPL slash commands: `/help`, `/id`, `/info`, `/model`, `/title`, `/history`, `/fork`,
  `/switch`, `/exit`.
- Profiles are local aliases (gateway URL, key, model). A key is never sent to a gateway it
  was not saved for. Keys come from a hidden prompt or `--api-key-stdin`. Config writes
  are atomic with 0600 permissions.
- Global install: `npm run build && npm install -g .` in `cli/`.

Personas: one Ollama Modelfile (`Modelfiles/backend-mentor.Modelfile`): `FROM llama3.2:3b`,
`temperature 0.2` (Ollama default 0.8), `num_ctx 4096` (default 2048), a system prompt.
It is host-only configuration: it needs `ollama create` and an `ALLOWED_MODELS` edit.

Quality: 13 unit, 38 integration and 56 CLI tests. CI runs typecheck, unit, integration
and CLI checks.

### Not built (known limitations)

- Ollama is the only provider. Models come from one global `ALLOWED_MODELS` list.
- A server crash mid-answer loses the in-flight text (the user message is kept).
- No retry or continue for partial answers.
- No export, import, search, pin or archive.
- No key management endpoints (keys only via `npm run key:create`). No `last_used_at`,
  `expires_at` or key names beyond an optional `label`.
- The CLI stores the API key in plaintext (0600 file). No keychain yet.
- No UI for non-technical users. Requires Docker (Postgres and Redis) to run.

---

## 3a. Run modes: one app, two modes

One product and one codebase that runs in two modes. The split is about how many people
share the installation, not developers versus individuals.

| | Single-user mode (default) | Server mode (opt-in) |
| --- | --- | --- |
| Who | One person on their own computer (everyday users, and developers who just want to use it) | Several people sharing one machine or server (household, small team) |
| Database | SQLite, one file in a data folder | Postgres |
| Rate limiting | In memory, inside the gateway process | Redis |
| Metrics | `/metrics` still served, nothing scrapes it; `/v1/stats` reads the database | Prometheus scrapes `/metrics` |
| Needs | Node and Ollama | Docker (Postgres, Redis, optional Prometheus) |
| Started by | One command, or the installer | `docker compose up` + the gateway |

How the mode is chosen (configuration only, never a question to the user):
- `DATABASE_URL` set -> Postgres; not set -> SQLite in the data folder.
- `REDIS_URL` set -> Redis rate limiter; not set -> in-memory rate limiter.
- Everyday users only ever see single-user mode. A "Share with your household" setting
  that switches modes may come with Phase 5.

Design rules:
- Routes, services, streaming, forks, personas and every user-facing feature are shared.
  Only adapters differ: storage (repository interfaces with a Postgres and a SQLite
  implementation) and the rate-limit store. This is ports and adapters.
- Admission control (the Semaphore queue protecting the GPU) is in-process in both modes.
- Why each dependency can drop out for one person: Postgres earns its place with many
  concurrent writers, but one process works fine on SQLite. Redis only exists so several
  gateway processes share a rate-limit counter, and one process needs no sharing (a reset
  on restart is harmless). Prometheus is an operator tool, not a user feature.
- Postgres-only SQL to replace in the SQLite adapter: `percentile_cont` (stats; compute
  p50/p95 in code), `FOR SHARE` (forks; use a transaction), `make_interval` (leases).
- Mode-specific features: key management, per-person budgets and household isolation
  matter in server mode. Installer, first-run model pick and zero-config setup are
  single-user. Everything else must work identically in both.

### Testing both modes

1. **Every change, automatically:** one shared API test suite runs twice in CI, once on
   SQLite (single-user) and once on Postgres + Redis (server). A change that breaks either
   mode turns CI red immediately. Mode-specific tests run only in their mode.
2. **Every feature, by hand:** before calling a feature done, run it once in each mode
   (for example `llm export` then `llm import` in both).
3. **Every phase gate, end to end:** a fresh single-user install on a clean setup, plus a
   server-mode run with Docker, walking through the gate's "done when" in both.

Building this shared suite and the CI matrix is part of Phase 1a.

---

## 4. Decisions that reconcile the two earlier docs

| Topic | Earlier plan (Research & Plan) | Decision now |
| --- | --- | --- |
| Primary user | Developer, terminal-first | Everyday user first; the developer CLI and API are the power layer |
| Order | Personas, keys, resilient CLI, then web UI, then providers | Phase 1 makes it runnable without Docker, then everyday features. Personas, recovery, portability, branching and keys all land in Phase 2 |
| Phase numbering | 0 to 7 (Providers = 4, RAG = 5, MCP = 6, Operate = 7) | 0 to 5 plus 2b (section 5). Operate is an engineering track, not a phase |
| Personas | Stored in Postgres, applied per request by the gateway; Modelfile import optional | Same, and also stored in SQLite in single-user mode. Shown to everyday users as a gallery of "assistant" cards |
| Privacy mode names | `local-only`, `local-preferred`, `cloud-allowed` | Keep these as the internal policy values. Show users Private, Balanced and Best quality |
| Privacy mode timing | Spec now, build with providers (old Phase 4) | Provider badge in Phase 2. Modes and providers in Phase 2b, before documents and memory (Phase 3) |
| Session recovery status | Mark the generation `interrupted`, `llm recover` | Assistant message rows get `streaming` while running, checkpointed; stale ones become `partial` on startup. `llm recover` stays as the CLI entry point |
| Web UI | Old Phase 3 | Part of Phase 1 (simple chat window) |
| App shape | Open | Decided 2026-10-13: a local web app served by the gateway first, with a reliable install and startup flow. Choose Tauri or Electron later, after measuring first-run friction, updates, background processes and resource use |
| `/v1/stats`, profile bugs, integration tests | Phase 0 | Done |

---

## 5. Roadmap overview

Each phase ends at a gate: one observable thing that proves it is done. Numbers are
targets, not measurements. Sizes are rough, for one developer working part time.

| Phase | Name | Goal | Gate (done when) | Status |
| --- | --- | --- | --- | --- |
| 0 | Stabilize | Make the engine trustworthy | All tests green | Done |
| 1 | One-click app | A non-technical person gets a first answer without a terminal | On a clean Mac, first answer within 5 minutes of opening the installer (excluding download), history survives restart | Next (recommended) |
| 2 | Everyday assistants | Useful for ordinary tasks before learning anything | 5 non-technical testers use it a week, none asks for setup help | Planned |
| 2b | Engines and privacy modes (proposed) | Choose Private / Balanced / Best quality; more than Ollama | In Private mode, making the local model unavailable ends in an error and zero cloud requests | Proposed |
| 3 | Your own stuff | Answers that know your documents and preferences | Every document answer shows its source; any memory can be viewed and deleted in two clicks | Planned |
| 4 | Faster and smarter | Quicker on the same laptop, picks the right model | Median time to first word improves by a measured margin, no quality drop on a fixed question set | Planned |
| 5 | Tools and sharing | The assistant can act; a household or team can share a machine | No tool runs without a visible, reviewable permission; nobody can read another person's chats | Planned |
| Ops | Operate (engineering track) | Production habits | Load test passes | Any time after Phase 2 |

---

## 6. Phase details and feature specs

Format for each feature: user story, behaviour, technical notes, done when.

### Phase 1: One-click app

#### 1a. Single-user engine (build first)

*As someone with only Node and Ollama installed, I want one command to start everything.*

- Storage seam: define repository interfaces for users, keys, conversations, messages,
  generations. Keep the Postgres implementation; add a single-user implementation.
- Spike first (about an hour): SQLite versus an embedded Postgres. Current Postgres-only
  features to handle: `percentile_cont` in stats, `FOR SHARE` in forks, `make_interval`
  in leases. In SQLite, compute p50/p95 in code and use transactions instead of row locks.
  **Decided (spike, 2026-10-11): SQLite via better-sqlite3.** PGlite ran the existing
  integration suite with a one-line change, but used ~280-900 MB of RAM and took ~0.8 s
  to create a DB, against ~16 MB and ~10 ms for SQLite. On a 16 GB laptop the RAM belongs
  to the model. Both survived `kill -9` with no lost commits. Numbers:
  `docs/phase-1a-plan.md` section 3.
- Rate limiting: in-process when no Redis is configured.
- Zero-config first run: create a data folder, the database and a local user and key;
  the CLI is configured automatically on the same machine.
- Model auto-pick: read total RAM and the models Ollama has installed; recommend one that
  fits. Plain-language errors ("Ollama is not running. Open the Ollama app and try again").
- One shared API test suite runs against both backends, so they cannot drift; CI runs it
  as a matrix (SQLite, Postgres + Redis). See section 3a.
- `llm doctor`: plain-language diagnostics. Checks that Ollama is running and reachable,
  the chosen model is installed, the gateway port is free or answering, the database opens
  and is migrated, and the CLI config is valid. Each failure says what to do next.
- Backup and restore: `llm backup` and `llm restore` with a tested round trip (SQLite's
  online backup in single-user mode; `pg_dump` guidance in server mode), not "copy this
  folder".
- OpenAPI: generate the specification from the existing zod schemas and test the public
  API contract against it.
- Migration upgrade test: start from the oldest migration with data in it, upgrade to the
  latest, and check nothing is lost.
- Done when: on a machine with only Node and Ollama, one command starts the gateway and
  `llm chat` works without setting up keys; the shared suite passes on both backends;
  `llm doctor` reports a clear fix for "Ollama not running" and "model missing"; a backup
  restored into a fresh data folder shows the same conversations.

#### 1b. App shell

- Wait for the wedge decision (section 1a) before starting 1b.
- Installer for macOS, first-run model download with progress in plain words, a simple
  chat window with saved history.
- App shape (decided): a local web app served by the gateway, opened in the browser.
  Revisit Tauri or Electron only after measuring first-run friction. Do not let the app
  shell become a project of its own.
- Code signing and notarization requirements for macOS are unchecked; check before
  promising an installer.
- Done when: the Phase 1 gate in section 5.

### Phase 2: Everyday assistants

#### 2.1 Personas (assistants)

*As a user, I want to pick a saved assistant by name so I get consistent answers without
retyping instructions.*

- A persona holds name, description, base model, system prompt, temperature, context
  window, visibility. Stored in the database, applied by the gateway per request. No
  `ollama create` needed.
- A conversation records which persona it used and a snapshot of its settings, so editing
  a persona later does not change how old conversations read.
- CLI: `llm persona list | show | create | edit | delete`, `llm persona import <Modelfile>`
  (reads `FROM`, `SYSTEM`, `PARAMETER`), `llm chat --persona backend-mentor`, `/persona` in
  the REPL.
- Everyday layer: a gallery of cards ("Study buddy", "Writing helper", "Code mentor",
  "Code reviewer", "Interview coach", "Summarizer").
- Fix the drift: the context window lives in the persona and the gateway's context budget
  must use the same number.
- Done when: `backend-mentor` runs with no `ollama create` and no env edit, and a persona
  created in the CLI shows up in `llm models` / the gallery.

#### 2.2 Session recovery

*As a user, when a long answer breaks halfway, I want to keep what arrived and decide
what to do next.*

- Create the assistant message at the start with status `streaming`; checkpoint its text
  every few seconds (not every token, to avoid write amplification).
- On startup, mark stale `streaming` rows `partial` and record the generation as
  interrupted.
- The client sends a request ID; a retry with the same ID never creates duplicate
  messages. The lease is released or expires cleanly.
- CLI: on next launch or with `llm recover`, list interrupted replies with age and tokens
  recovered, and offer: continue, fork from the recovered reply, retry from the last
  question, or discard.
- Later: reconnect to a still-running answer after a refresh. Decide first whether closing
  the window cancels (today it does) or lets it finish (then Stop must be explicit).
- Done when: killing Ollama or the server mid-stream leaves a recoverable reply, each of
  the four choices works, and no duplicate messages appear.

#### 2.3 Portable and findable conversations

*As a user, I want to treat a conversation like a document: save it, move it, find it later.*

- CLI: `llm export <id> --format md|json`, `llm import <file>`, `llm search "<text>"`,
  `llm pin`, `llm archive`, `llm recent`.
- JSON export is versioned and carries message IDs, model, persona and fork links.
  Import always creates a new conversation, never merges, and is idempotent (importing the
  same file twice must not create duplicates; Open WebUI has this problem).
- ChatGPT export import: verify the real format first.
- Search: database full-text search (Postgres in the gateway, SQLite's equivalent in
  single-user mode), per user, returning title, snippet and date.
- Done when: export then import yields an identical transcript, and search finds a phrase
  that exists only on a forked branch.

#### 2.4 Branch navigation ("Try another way")

*As a user, I want to see where my conversation split and explore alternatives without
losing my place.*

- `llm tree [id]` prints parent, children, titles and message counts. `/fork 7` forks at
  message 7.
- `llm regenerate` forks at the last question with a different model or persona, so a
  retry becomes a sibling branch instead of overwriting the answer.
- `llm diff <a> <b>` shows the first message where two branches diverge.
- Everyday layer: a "Try another way" button, and later a branch map.
- Done when: a three-level fork tree prints correctly and a regenerated answer appears as a
  sibling in the tree.

#### 2.5 Trustworthy identity and key management (power layer)

*As a user with a personal and a work gateway, I want to know which key I am using and be
sure it only goes to its own server.*

- Validate the key against `GET /v1/me` on `profile add`; add `--profile` and
  `LLM_PROFILE`; show key name and prefix in `whoami`.
- Server: `api_keys` gains `name`, `last_used_at`, `expires_at`. Endpoints and CLI:
  `llm keys list | create | revoke`. The profile name stays on the client; no `profiles`
  table.
- `last_used_at`: updated in the auth hook for every authenticated request except routes
  flagged `skipUsage` (the key-info endpoint, health), and at most once a minute:
  `UPDATE ... WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`,
  fire-and-forget, never failing the request.
- `GET /v1/me/api-key` returns `{ id, name, createdAt, lastUsedAt }` in camelCase. No
  `revokedAt`: a revoked key gets 401 before reaching it. The CLI maps 200 to active,
  401 to revoked or invalid (deliberately not distinguished), network error to unavailable.
- OS credential store: a keychain adapter (macOS Keychain first) so the CLI stops storing
  raw keys in the config file; the 0600 file stays as the fallback.
- `llm profile list` stays offline and instant. `llm profile list --check` queries each
  profile in parallel with a 2 to 3 second timeout; one failure shows `unavailable` and
  never aborts the list.
- Done when: a mistyped key is rejected at `profile add`, and revoking a key from the CLI
  makes the next request on it fail with a clear message.

#### 2.6 Trust & Privacy Center: provider badge, context inspector, memory meter

One named screen (and `llm trust` in the CLI) instead of scattered badges. Everyday users
see whether their data stays local, what is remembered and how to erase it. Developers see
provider selection, request traces and what entered each response's context. It grows
with later phases (privacy modes in 2b, memory and documents in 3, tool calls in 5).

- Every reply shows where it ran, for example `LOCAL · Ollama`, taken from the `meta`
  event (not from settings). Costs almost nothing now and makes Phase 2b honest later.
- Context inspector: show exactly what was sent to the model and how the token budget was
  spent (context builder and token counter already exist).
- Memory meter in plain words: "The last 14 messages are in view; 6 older ones were left
  out" (from `contextUsed`, `contextBudget`, `droppedMessages`).
- Privacy badge for everyday users: "Runs on this Mac. Nothing leaves it."
- Quality/Speed slider instead of `num_ctx` and temperature.

### Phase 2b (proposed): Engines and privacy modes

*As a user, I want to choose how private each conversation is, and see at a glance whether
my data stayed on this machine.*

Providers:
- Today only `OllamaProvider` implements `LLMProvider { name; chat(req) }`. Add an
  Anthropic provider and one OpenAI-compatible provider (which may also cover local
  servers such as LM Studio and llama.cpp; verify before relying on it).
- Build-or-reuse check: LiteLLM already routes to many providers. Evaluate running it as
  one adapter behind `LLMProvider` before writing several cloud providers by hand. Our
  privacy policy must stay in our gateway either way.
- A model registry mapping each model to its provider and to `local` or `cloud`, replacing
  the single `ALLOWED_MODELS` list. Track model version, configuration, context limit and
  capabilities where the provider reports them.
- Provider keys live server-side only (gateway secrets; OS keychain in single-user mode),
  never in a CLI profile or log. Keep two concepts apart: the gateway key a user holds, and
  the provider key the gateway holds.
- Cost estimate per cloud answer next to the stored token counts.
- Token budgets per key (daily limits) for the small-team segment.

Privacy modes (policy values `local-only` / `local-preferred` / `cloud-allowed`, shown as
Private / Balanced / Best quality), set per persona, conversation or key (a profile only
points at a key, so it inherits the key's default):
1. The server enforces the mode; a client claim proves nothing.
2. Fail closed: Private never falls back to cloud; it errors.
3. Automation only moves toward private. A classifier may route to local, never to cloud
   without consent. Redaction (for example Presidio) is probabilistic and never counts as
   a guarantee.
4. Moving a conversation from Private to a cloud model would send every earlier message:
   require a confirmation that says how many messages will go.
5. Balanced asks per message before anything goes to the cloud, with a preview of exactly
   what will leave.
6. Open question: "local" should mean the model runs on the same host as the gateway, and
   the badge should name the host, so a remote gateway is never labelled local by mistake.

Done when: a `local-only` persona fails loudly when only a cloud provider is available,
and in Private mode a test with the local model down records zero cloud requests.

### Phase 3: Your own stuff

- File ingestion: store file metadata in the database and file contents separately; hash
  each file so unchanged files are never re-processed.
- "Ask my files" over a chosen folder, answers citing the source page; embeddings and
  index stored locally (pgvector in the gateway; single-user store to be decided), with
  commands to inspect and clear them. Measure quality with a pass/fail eval set.
- Visible, editable memory ("Remember that I prefer short answers"): every item shows
  where it came from and can be deleted. Memory injection is a known attack, so nothing is
  stored silently.
- Import of an exported ChatGPT history (builds on 2.3).
- Voice in and out on device (for example whisper.cpp and Kokoro-82M; 16 GB recommended so
  chat and voice models fit together). Voice needs shorter answers.
- Done when: the Phase 3 gate in section 5.

### Phase 4: Faster and smarter

- Model manager in plain words: what each model is good at, disk size, update, delete.
  Show installed versus allowed models; downloading stays with Ollama.
- Routing: quick questions to a small model, hard ones to a larger one.
- Machine-aware advice from measured runs: "On this 16 GB Mac this model gives about N
  tokens/s; this one will not fit well" (TTFT and tokens/s are already recorded).
- Speculative decoding where the runtime supports it (claimed 1.5x to 3x in some cases;
  needs a draft model with the same tokenizer, small enough for 16 GB).
- MLX backend: watch item. Ollama's MLX preview reportedly needs 32 GB or more.
- Battery-friendly mode; weekly summary ("42 chats, first words in under 2 seconds");
  usage dashboard on `/v1/stats`.
- Savings meter: estimate what a month of local use would have cost on a paid cloud model,
  clearly labelled as an estimate with a maintained price table.

### Phase 5: Tools and sharing

- Tools via MCP: read-only first, a permission prompt on every call at first (no
  always-allow), per-tool allow lists, calls shown in the context inspector, an audit log.
  Known threats: prompt injection, tool poisoning, memory injection; sandbox and least
  privilege.
- Household mode: each person their own history on a shared home Mac (the multi-user
  gateway already isolates users).
- Reach your home Mac from a phone over a private link; optional encrypted backup.

### Operate (engineering track)

- Grafana dashboards on the existing Prometheus metrics, response caching, load shedding,
  a load test. Schedule any time after Phase 2; good system-design practice.
- Request tracing: request IDs already exist (`generations.request_id`). Add OpenTelemetry
  step by step, starting with one trace per generation; no elaborate observability stack
  up front.
- Server secrets: environment variables in development, a proper secret store in
  production deployments.

---

## 6a. Engineering standards (apply in every phase)

| Area | Standard |
| --- | --- |
| Runtime validation | zod for API inputs and provider responses, alongside TypeScript types |
| API contract | OpenAPI generated from the schemas; contract tests run in CI |
| Migrations | Versioned; an upgrade test from older schemas with data |
| Two modes | The shared suite runs on SQLite and Postgres; Redis-dependent behaviour tested separately |
| Credentials | OS keychain adapter on the client; env vars in development and a secret store in production on the server |
| Backups | A tested backup and restore command, not a folder to copy by hand |
| Evaluation | A fixed set of representative prompts to catch regressions when models or prompts change |
| Model metadata | Version, configuration, context limit and capabilities recorded per model |
| Dependencies | Do not add an orchestration framework, search cluster, vector database, job system and several inference engines at once. Each one needs a reason tied to a feature in the current phase |
| Vector search | Arrives with documents and memory (Phase 3), never in the first-install experience |

---

## 7. Unique features (why pick us)

| Feature | What the user sees | Why it is hard to copy | Status |
| --- | --- | --- | --- |
| Try another way | Branch a chat at any message, keep both paths | Forks are a real data model, not a regenerate button | Built (API, CLI); UI in Phase 2 |
| Visible privacy | Badge, later a panel proving zero outside connections | The app must be offline by design and prove it | Phase 2 / 2b |
| Assistants in plain words | Cards such as "Study buddy" | Persona = model + prompt + settings, exportable | Phase 2 |
| Fits your machine | First run picks a model by memory | Needs measured per-machine data | Phase 1, refined in 4 |
| Chats that survive | Crash mid-answer, the chat comes back | Partial saves and leases exist; crash checkpoints in Phase 2 | Partly built |
| "Why is it slow?" in plain words | "Another chat was running, yours waited 6 seconds" | Queue time and TTFT measured per request | Metrics built |
| One engine, laptop to household | Same app, separate histories | Multi-user from day one | Built; household mode in Phase 5 |
| A real power layer | CLI, API, keys, stats | Tested contracts, not a demo | Built; keys in Phase 2 |

---

## 8. Future bets (researched, not scheduled)

| # | Bet | Finding | Fit on 16 GB |
| --- | --- | --- | --- |
| 1 | Local voice | whisper.cpp + Kokoro-82M run on Apple Silicon | Good; in Phase 3 |
| 2 | Safe tools (MCP) | LM Studio added MCP host in 0.3.17 (25 Jun 2025) with per-call confirmation | Developers now; safer default for everyone; Phase 5 |
| 3 | Memory you can see and edit | Common in competitors; memory injection is a known attack | Cheap to build, hard to make trustworthy; Phase 3 |
| 4 | Faster answers | Speculative decoding 1.5x to 3x claimed; MLX preview needs 32 GB+ | Speculative only with a tiny draft; MLX watch |
| 5 | Consent-based cloud help | Apple routes between on-device and Private Cloud Compute (single secondary source) | Opt-in per message, off by default; Phase 2b |
| 6 | Native Apple runtime (Core AI) | Reported by one secondary source; Apple docs not checked | Research only |
| 7 | Personal model scorecard (our idea) | Run your saved prompts through each installed model | Prototype first |

More ideas (unscheduled): proof of privacy panel, preview of what leaves, second opinion
(two models side by side), branch map, overnight jobs, Hindi and Hinglish assistants
(needs model-quality testing first).

---

## 9. Competitive landscape (summary)

No product reviewed combines a branching conversation store, gateway-style controls (keys,
queueing, budgets) and an everyday-user experience for local models.

| Product | Best at | Gap for our users |
| --- | --- | --- |
| Ollama | Simple model serving, Modelfile presets | A runtime: no conversations, accounts, usage or budgets |
| LM Studio | Model browser, chat, document RAG, MCP | One person's machine; no multi-key or team controls |
| Open WebUI | Broadest features (RAG, workspace models, tools, RBAC) | Large surface to run; not simple for non-technical users |
| Jan | Clean desktop chat, OpenAI-compatible server | Light conversation management |
| AnythingLLM | Document Q&A, workspaces, agents | Document-centric, not conversation-centric |
| Msty, GPT4All | Polished UX, easiest onboarding | Basic RAG or no multi-account; no developer controls |
| Gemini CLI, Claude Code | Memory files, rewind, headless mode | Cloud models; sessions are agent work, not branchable conversations |
| LiteLLM | Open-source gateway: many providers, rate limits, budgets, key management | A gateway, not a product for end users; overlaps our server mode directly |

Table stakes (match, do not compete): streaming chat, resume, model switching, an
OpenAI-compatible API, a headless mode, some document chat.
Not settled by the market (our openings): branching as a first-class idea, portable
conversations, recovery of interrupted replies, a visible guarantee of where data went.

---

## 10. Do not build yet

- A server-side `profiles`, `workspaces` or organizations table. The profile stays a
  client alias until a real policy needs it.
- Agents, sandboxing or a plugin marketplace.
- Our own model downloader or a mobile app.
- RAG, MCP or cloud providers before Phases 1 and 2 are solid.

---

## 11. Risks

- Weak model quality: a 3B model on 16 GB limits reasoning; honest, machine-aware
  expectations help more than prompt tweaks.
- A false privacy claim: a "local only" badge that is ever wrong is worse than no badge.
  Enforce in the gateway and cover with tests.
- Two storage modes drifting apart: one shared test suite for both.
- Hardware gap: speed research mostly uses bigger machines; re-measure on 16 GB.
- Tool safety: permission prompts alone are not enough without sandboxing and an audit log.
- Distribution: macOS signing and notarization unchecked; model licences unreviewed.
- Evidence gap: competitor facts come partly from secondary articles; check vendor docs
  before any public claim.
- Time: one developer, part time. Each phase must end in something usable.
- Plaintext keys until keychain storage exists.

---

## 12. Open decisions

1. Wedge (section 1a): personal workspace, private AI box for small offices, or developer
   hybrid routing. Decide after the five interviews, before Phase 1b.
2. Order: Phase 1a (single-user engine) before the key-management feature. Recommended:
   yes.
3. ~~Storage for single-user mode: SQLite or embedded Postgres.~~ Decided: SQLite
   (better-sqlite3), see section 6, 1a.
4. Platforms: macOS only for Phases 1 to 3, or Windows too.
5. Cloud providers: support Claude and OpenAI at all, or stay local-only? If yes, Phase 2b
   before Phase 3 (recommended), and decide whether LiteLLM sits behind `LLMProvider`.
6. Interviewees: who are the five people (two small-firm owners, two developers, one
   everyday user)? See `docs/interview-guide.md`.
7. Should a conversation behave like a file, a Git branch or a chat thread? Shapes tree,
   export and merge.
8. Personas: private per user, or shareable (needs a visibility field from day one)?
9. Modelfile import only, or should the gateway also run `ollama create`?

Decided: app shape is a local web app first (section 4, 2026-10-13).

---

## 13. How we will know it works (weekly dogfooding)

- A new persona goes from idea to first reply in under five minutes, with no file edited on
  the host.
- After a forced Ollama crash, the interrupted reply is recovered every time.
- At least one conversation a week is resumed, forked or exported.
- No credential ever reaches a server it was not added for (regression test).
- From Phase 1: a fresh install reaches a first answer within the gate time.

---

## 14. Sources

Research pages opened on 7 Oct 2026. "Secondary" means a third-party comparison, not
vendor documentation.

- Ollama Modelfile reference and pricing; Open WebUI workspace models and features;
  LM Studio vs llmster vs lms.
- Secondary: LM Studio vs Ollama 2026; Msty vs Jan vs GPT4All; Jan vs AnythingLLM;
  Gemini CLI vs Claude Code.
- [Best local AI assistants (Vellum)](https://www.vellum.ai/blog/best-local-ai-assistants)
- [MCP in LM Studio](https://lmstudio.ai/blog/mcp)
- [LM Studio 0.3.10: speculative decoding](https://lmstudio.ai/blog/lmstudio-v0.3.10)
- [Ollama MLX preview (secondary)](https://lilting.ch/en/articles/ollama-mlx-apple-silicon-preview)
- [On-device AI after WWDC 2026 (Callstack, secondary)](https://callstack.com/blog/on-device-ai-after-wwdc-2026-whats-new)
- [Threats in LLM agent workflows (arXiv 2506.23260)](https://arxiv.org/pdf/2506.23260)
- [Local voice AI (DEV Community)](https://dev.to/alichherawalla/the-all-in-one-local-voice-ai-built-in-tts-stt-and-audio-mode-on-device-2g4c)
- [Resumable streams (AI SDK)](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams)
- [SSE token streaming pitfalls (zknill)](https://zknill.io/posts/everyone-said-sse-token-streaming-was-easy/)
- [Open WebUI import and export](https://docs.openwebui.com/features/chat-conversations/data-controls/import-export)
- [Hybrid cloud/local LLM routing (SitePoint)](https://www.sitepoint.com/hybrid-cloudlocal-llm-the-complete-architecture-guide-2026/)
- [PII redaction with Presidio (Elest)](https://blog.elest.io/self-host-presidio-redact-pii-before-it-ever-reaches-your-llm/)
