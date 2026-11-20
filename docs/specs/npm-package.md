# Spec: install and run without cloning (npm package)

Status: published 2026-11-20 as local-llm-gateway@0.1.0 (verified: installed from the
registry into an empty folder, `llm start`, zero-config key, a real chat answer). Decided by the owner: one package, name
`local-llm-gateway`, commands `llm` and `llm-gateway` (keeping `llm` despite the clash with
the Python tool), MIT license, the owner publishes. Step 1 of "Next up" in the roadmap (Phase 1).

## Why
Today a person must clone the repo, run `npm ci` twice, build twice, and `npm install -g`
the CLI. The gate walk proved the engine works, but that path is for developers of this
project. This step makes it one install, still for people comfortable with a terminal. The
no-terminal Mac app comes later and will wrap the same package.

## What the user does (target)
```bash
npm install -g local-llm-gateway     # or, to try it: npx -p local-llm-gateway llm start
llm start                            # starts the assistant (single-user mode, no setup)
llm chat "hello"                     # in another window
```
`llm start` runs the gateway in the foreground (Ctrl+C stops it), exactly like `npm start`
today. Server mode works by setting the same environment variables (`DATABASE_URL`,
`REDIS_URL`), or `llm start --env-file .env`.

## Decisions (recommended choices first)
1. **One package containing both the gateway and `llm`.** One install, one version, the CLI
   always matches its gateway. (Alternative: two packages; more to publish and keep in step.)
2. **Name `local-llm-gateway`** (free on npm today). Alternative: a scoped name such as
   `@<your-npm-user>/llm-gateway`, which nobody else can take.
3. **Command names:** keep `llm` (what all our docs use) and add `llm-gateway` for the
   server. Known clash: Simon Willison's popular Python tool is also called `llm`; on a
   machine that has it, whichever was installed last wins. Alternative: rename ours now,
   before anyone depends on it (for example `lgw`).
4. **License:** none exists yet, so nobody may legally use the code. Recommended: MIT
   (simple, matches Ollama). Owner's call.
5. **Publishing** to npm is outward-facing and needs the owner's npm account: the code is
   prepared and tested here; the owner runs `npm publish`.
6. **Not in this step:** a background service (launchd), auto-update, Homebrew, a bundled
   Node runtime. Those belong to the installer.

## Plan
1. Root `package.json`: `engines` (Node 22+), `bin` (`llm` → `cli/dist/index.js`,
   `llm-gateway` → `dist/src/server.js`), `files` allow-list (`dist/src`, `drizzle`,
   `cli/dist`, `README.md`, `LICENSE`) so nothing else can be published, `commander` as a
   dependency (the CLI's only one), `prepack` builds gateway and CLI.
2. `src/server.ts`: a `#!/usr/bin/env node` line so it runs as a command.
3. CLI: `llm start [--env-file <path>]` spawns the gateway next to it (same Node, output
   passed through, Ctrl+C forwarded). In the repo and in the package the layout is the same
   (`cli/dist` next to `dist/src`), so one path works for both.
4. `llm doctor` and the "assistant isn't running" message say `llm start` when installed
   from the package, `npm start` in the repo.
5. A packaging smoke test (`scripts/pack-smoke.sh`, also in CI): `npm pack`, install the
   tarball into a temp folder, start `llm-gateway` with a temp `DATA_DIR`, check `/healthz`,
   run `llm doctor --json` and `llm start` → stop. Proves the published package works
   without publishing it.
6. README quick start: the npm install path first; cloning moves to "For developers".

## Done when
- The smoke test passes in CI from a packed tarball, on a machine with no clone.
- `npm pack --dry-run` lists only the allow-listed files (no `.env`, tests, docs, spikes).
- The owner has run `npm publish` (after choosing name and license), and
  `npm install -g local-llm-gateway && llm start` works on the gate-walk account.

## Risks
- `better-sqlite3` is a native module: npm downloads a prebuilt binary for common
  platforms; on an unusual platform it compiles and needs build tools. The installer later
  avoids this by bundling Node.
- Installing `-g` in a second macOS account may hit the Homebrew permissions problem noted
  in the gate walk. `npx` avoids it for trying out.

## Follow-ups found after publishing
- Plain `npx local-llm-gateway` failed in 0.1.0 ("could not determine executable to run"):
  two commands, neither named after the package. Fixed in 0.1.1 (a `local-llm-gateway`
  command that starts the assistant).
- npm warned that `prom-client` is deprecated. Fixed in 0.1.1: `@prometheus-io/client`, the
  same library under its new name.
- First publish of a new name goes through npm's staged publishing: a public placeholder
  `0.0.0-stage` appears first, the real version a few minutes later.
