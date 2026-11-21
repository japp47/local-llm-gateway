# Spec: web chat page

Status: decided 2026-11-20 (React + Vite, sign-in by `llm open` link, core + extras). Step 2 of "Next up" in the roadmap
(Phase 1). It does not wait for the wedge decision: every wedge needs a chat that is not a
terminal, and phone access (step 3) is built on this page.

## Why
Today the only way to chat is `llm chat` in a terminal. No everyday user or office worker
will do that. The gateway already has everything a chat needs (conversations, streaming,
history, models, doctor); this step gives it a face, served by the gateway itself
(decided earlier: a local web app first, no Electron/Tauri yet).

## What the user does (target)
```bash
llm start          # as today
llm open           # opens the browser, already signed in
```
Then, in the browser at `http://localhost:3000`:
- a list of conversations (newest first), a "New chat" button;
- a chat view: type, press Enter, the answer streams in word by word; earlier messages
  above; a "Stop" button while it answers;
- the model in use, shown small; plain-language problems shown as a banner with the fix
  ("Ollama isn't running. Open the Ollama app, then try again.");
- rename and delete a conversation.

## Security (not optional)
The gateway listens on `localhost`. Any website the user visits can also send requests
to `localhost:3000` (CSRF) or trick the browser into treating its own domain as
localhost (DNS rebinding). So the browser gets no shortcut:
1. **Sign-in by one-time link.** `llm open` asks the gateway (with the CLI's key) for a
   one-time code that expires in 60 seconds, and opens `http://localhost:3000/#code=...`. The
   page exchanges the code once for a session.
2. **Session cookie**, `HttpOnly` (scripts can't read it), `SameSite=Strict` (other sites'
   requests don't carry it), `Path=/`, expiring after inactivity. Stored server-side as a
   hash, like API keys. Sign out deletes it.
3. **Host check:** requests whose `Host` is not `localhost`/`127.0.0.1`/`[::1]` (or the
   configured host) are refused. This defeats DNS rebinding.
4. **Origin check** on every state-changing request with a cookie: the `Origin` must be
   the gateway itself. Defence in depth against CSRF.
5. **Content-Security-Policy:** only the gateway's own scripts and styles; no inline
   scripts, no third-party anything. Model output is shown as text: a small safe markdown
   renderer (code blocks, bold, lists, links as plain text) that escapes everything first.
   Model output must never become HTML. A model can be tricked into writing `<script>`.
6. API keys keep working exactly as today (CLI, scripts); the cookie is an additional way
   in, for the browser only. Server mode: users paste their own API key once on a sign-in
   page instead of `llm open`.

## Decisions (owner, 2026-11-20)
1. **React + Vite** (React 19.3, Vite 8.3, `@vitejs/plugin-react` 6.3). The page lives in
   `web/`, Vite builds it into `dist/web/`, the gateway serves it. React and Vite are
   development dependencies only: the published package ships the built files.
2. **Sign-in by one-time link:** `llm open`.
3. **First version: core + extras:** conversation list, new chat, streaming with Stop,
   rename, delete, problem banner, **plus** model picker, backup button and "Branch from
   here" (forks).

## Build order (one commit each, all suites green after each)
1. **Sign-in backend.** `sessions` table in both schemas (token hash, user, created, last
   seen, expires) with migrations, storage port and both adapters, contract tests.
   `@fastify/cookie`. The auth hook accepts a Bearer key **or** a valid session cookie.
   `POST /v1/web/codes` (key-authenticated: a one-time code, 60 s), `POST /web/session`
   (exchanges the code once, sets the cookie), `DELETE /web/session`. Host check (all
   requests) and Origin check (cookie requests that change state). OpenAPI + contract test.
   `llm open` (macOS `open`, Linux `xdg-open`, otherwise print the link).
2. **The page, core.** `web/` with React + Vite; served at `/` with `@fastify/static` and a
   strict Content-Security-Policy. Sign-in from `#code=`; conversation list; chat with
   streaming (fetch + the existing SSE events) and Stop; rename; delete; problem banner
   from `{ error: { message, hint } }`. A safe markdown renderer: escape first, then code
   blocks, bold, lists; model output never becomes HTML. Unit tests for the renderer and
   the stream parser.
3. **Extras.** Model picker (`GET /v1/models`, per message), backup button
   (`POST /v1/backup`, single-user mode only), "Branch from here" on a message
   (`POST /v1/conversations/{id}/forks`).
4. **Ship it.** `dist/web` in the package `files`; `prepack` builds the page; the package
   smoke test fetches `/` and checks the CSP; e2e signs in with a code and streams one
   answer; README and CLAUDE.md.

Browser tests (Playwright) are not in this plan: a large tool. Logic is tested as plain
functions; the gateway side with the existing suites. Revisit if the page grows.

## Done when
- `llm start`, `llm open` → signed in, a new chat streams an answer, history survives a
  restart, Stop works, a stopped Ollama shows the plain banner.
- Another website cannot use the gateway through the browser: tested for a wrong `Host`,
  a wrong `Origin`, a reused or expired code, and a missing cookie.
- Both test suites, the contract test, e2e and the package smoke test pass.

## Out of scope (later steps)
Phone access (step 3: listening on Wi-Fi, QR pairing, Tailscale), document upload, the Mac
installer, multiple users signing in on one gateway's web page at once (server mode works
via pasted keys, nothing more).
