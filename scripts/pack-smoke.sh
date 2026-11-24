#!/usr/bin/env bash
# Proves the npm package works the way a stranger would use it, without publishing it:
# pack the tarball, install it into an empty folder, start it, chat-free checks, stop.
# Needs nothing running (no Ollama, no Docker): Ollama is expected to be "down" here.
# Usage: npm run pack:smoke     (CI runs it too)
set -euo pipefail
cd "$(dirname "$0")/.."

WORK=$(mktemp -d "${TMPDIR:-/tmp}/llmgw-pack.XXXXXX")
GW_PID=""
# Stops `llm start` and waits up to 15 s; never hangs (kills the gateway too if needed).
stop_gw() {
  kill -INT "$GW_PID" 2>/dev/null || return 0
  for _ in $(seq 1 60); do kill -0 "$GW_PID" 2>/dev/null || return 0; sleep 0.25; done
  pkill -KILL -P "$GW_PID" 2>/dev/null; kill -KILL "$GW_PID" 2>/dev/null
  return 1
}
cleanup() {
  [ -n "$GW_PID" ] && stop_gw
  rm -rf "$WORK"
}
trap cleanup EXIT
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32mPASS\033[0m %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; [ -f "$WORK/gw.log" ] && sed 's/^/    /' "$WORK/gw.log" | tail -20; exit 1; }

step "Pack (builds gateway and CLI first)"
[ -d cli/node_modules ] || (cd cli && npm ci --silent)
TARBALL=$(npm pack --silent --pack-destination "$WORK" | tail -1)
ok "packed $TARBALL ($(du -h "$WORK/$TARBALL" | cut -f1))"

step "Install into an empty folder, as a stranger would"
npm install --global --silent --prefix "$WORK/prefix" "$WORK/$TARBALL"
LLM="$WORK/prefix/bin/llm"
for cmd in llm llm-gateway local-llm-gateway; do [ -x "$WORK/prefix/bin/$cmd" ] || fail "command $cmd installed"; done
ok "llm, llm-gateway and local-llm-gateway are on the path"
# `npx local-llm-gateway` runs the command named after the package: it must be the server.
[ "$(readlink "$WORK/prefix/bin/local-llm-gateway")" = "$(readlink "$WORK/prefix/bin/llm-gateway")" ] || fail "local-llm-gateway starts the assistant"
ok "local-llm-gateway (what npx runs) starts the assistant"
npm install --global --prefix "$WORK/prefix" "$WORK/$TARBALL" 2>&1 | grep -qi "deprecated" && fail "installing prints no deprecation warnings"
ok "installing prints no deprecation warnings"

# A clean environment: own data folder, own CLI config, a free port, Ollama not running.
export DATA_DIR="$WORK/data" XDG_CONFIG_HOME="$WORK/config" PORT=3993
export LLM_BASE_URL="http://localhost:3993" OLLAMA_URL="http://127.0.0.1:9"
unset DATABASE_URL REDIS_URL LLM_API_KEY

step "llm start: first run, single-user mode, no setup"
"$LLM" start >"$WORK/gw.log" 2>&1 &
GW_PID=$!
for _ in $(seq 1 60); do curl -sf -m 1 "$LLM_BASE_URL/healthz" >/dev/null && break; sleep 0.25; done
curl -sf "$LLM_BASE_URL/healthz" | grep -q '"mode":"single"' || fail "gateway answers in single-user mode"
ok "the gateway answers in single-user mode"
[ -f "$DATA_DIR/gateway.db" ] && [ -f "$DATA_DIR/local-credentials.json" ] || fail "data folder, database and local key created"
ok "data folder, database and local key were created"
grep -q "Ollama isn't running" "$WORK/gw.log" || fail "startup warns that Ollama is not running"
ok "startup warns about Ollama and keeps running"

step "The CLI finds its key by itself"
"$LLM" whoami | grep -q "local@localhost" || fail "llm whoami"
ok "llm whoami -> local@localhost"
out=$("$LLM" doctor --json || true)
echo "$out" | grep -q '"id": "database"' && echo "$out" | grep -q '"status": "ok"' || fail "llm doctor runs the gateway's checks"
echo "$out" | grep -q "Ollama isn't running" || fail "llm doctor explains Ollama is down"
ok "llm doctor: gateway, key and database ok; explains that Ollama is down"
curl -sf "$LLM_BASE_URL/openapi.json" | grep -q '"openapi": *"3.1.0"' || fail "/openapi.json"
ok "/openapi.json served"

step "The web page and browser sign-in"
page_headers=$(curl -sf -D - -o "$WORK/page.html" "$LLM_BASE_URL/")
echo "$page_headers" | grep -qi "content-security-policy: default-src 'self'; script-src 'self'" || fail "the page has a strict Content-Security-Policy"
asset=$(grep -o '/assets/[^"]*\.js' "$WORK/page.html" | head -1)
[ -n "$asset" ] && curl -sf -o /dev/null "$LLM_BASE_URL$asset" || fail "the page's script loads"
ok "the page and its files are served, with a strict Content-Security-Policy"
code=$("$LLM" open --print | grep -o 'code=[^ ]*' | cut -d= -f2)
[ -n "$code" ] || fail "llm open --print gives a sign-in link"
curl -sf -c "$WORK/jar" -o /dev/null -X POST -H "origin: $LLM_BASE_URL" -H 'content-type: application/json' \
  -d "{\"code\":\"$code\"}" "$LLM_BASE_URL/web/session" || fail "the sign-in link signs the browser in"
curl -sf -b "$WORK/jar" "$LLM_BASE_URL/v1/me" | grep -q "local@localhost" || fail "the session cookie works"
ok "llm open: the one-time link signs the browser in"

step "Backup, stop, restore"
BACKUP=$("$LLM" backup --json | sed -n 's/.*"file": "\(.*\)".*/\1/p')
[ -f "$BACKUP" ] || fail "llm backup wrote a file"
ok "llm backup -> $(basename "$BACKUP")"
"$LLM" restore "$BACKUP" >"$WORK/restore.log" 2>&1 && fail "restore must refuse while the assistant runs"
grep -q "Stop it first" "$WORK/restore.log" || fail "restore explains it must be stopped"
ok "llm restore refuses while the assistant runs"
stop_gw || { GW_PID=""; fail "llm start stops within 15 s when sent SIGINT"; }
GW_PID=""
[ ! -e "$DATA_DIR/gateway.lock" ] || fail "Ctrl+C releases the lock"
ok "Ctrl+C stops it cleanly (lock released)"
"$LLM" restore "$BACKUP" | grep -q "Restored" || fail "llm restore"
ok "llm restore puts the backup back"

printf '\n\033[32mPackage smoke test passed.\033[0m\n'
