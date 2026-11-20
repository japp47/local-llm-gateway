# Changelog

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
