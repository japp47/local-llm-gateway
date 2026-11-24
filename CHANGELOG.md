# Changelog

## 0.2.0 (2026-11-24)

- **Web chat.** `llm open` opens the assistant in your browser at `http://localhost:3000`,
  already signed in: conversations, streaming answers with Stop, rename, delete, a model
  picker, a Back up button, and "Branch from here" on any message. Problems show as a plain
  banner with what to do. Light and dark mode.
- Browser sign-in is a one-time link (60 seconds, works once) exchanged for an HttpOnly,
  SameSite=Strict session cookie. Other websites can't use it: the gateway checks the Host
  and Origin of every cookie request, and the page runs under a strict Content-Security-
  Policy. Model answers are shown as text, never as HTML. API keys work as before.
- The gateway waits up to a second for Redis at startup, so rate limits apply from the
  first request (server mode).

## 0.1.1 (2026-11-20)

- `npx local-llm-gateway` now starts the assistant (0.1.0 said "could not determine
  executable to run"). Installing also adds a `local-llm-gateway` command, the same as
  `llm-gateway`.
- `llm` commands typed into the chat (for example `llm profile use local`) are no longer
  sent to the assistant; the chat says to type `/exit` first.
- Messages about a rejected key name the mode in plain words ("the single-user assistant")
  instead of developer commands.
- Metrics use `@prometheus-io/client`, the new name of `prom-client`, so installing no longer
  prints a deprecation warning. Metric names and output are unchanged.
- Built commands stay executable after a clean build (affected development links only).

## 0.1.0 (2026-11-20)

First release: the gateway and the `llm` terminal app in one package. `llm start` runs the
assistant with no setup (single-user mode, SQLite); `llm chat`, `llm doctor`, `llm backup`,
`llm restore`. Server mode (Postgres, Redis) by environment variables.
