#!/usr/bin/env bash
# End-to-end check of every feature, in both run modes, against real Ollama.
# Prints each command before running it, then PASS/FAIL. Never touches your real data:
#   single-user mode -> a temp DATA_DIR; server mode -> the llmgw_test database;
#   the CLI -> a temp config folder (your profiles are not used).
# Needs: Ollama with llama3.2:3b, `docker compose up -d postgres redis`, jq.
# Usage: bash scripts/e2e.sh            (after: npm run build && (cd cli && npm run build))
set -u
cd "$(dirname "$0")/.."

MODEL=llama3.2:3b
SINGLE_PORT=3990
SERVER_PORT=3991
SERVER_DB=postgres://llmgw:llmgw@127.0.0.1:5432/llmgw_test
REDIS=redis://127.0.0.1:6379
WORK=$(mktemp -d "${TMPDIR:-/tmp}/llmgw-e2e.XXXXXX")
RESP="$WORK/resp" HDRS="$WORK/hdrs" SSE="$WORK/sse"
PASS=0 FAIL=0 FAILS=() GW_PID="" MODE=""

# ---------- helpers ----------
bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
cmd() { printf '\033[2m$ %s\033[0m\n' "$*"; }
ok() { PASS=$((PASS + 1)); printf '  \033[32mPASS\033[0m %s\n' "$*"; }
bad() { FAIL=$((FAIL + 1)); FAILS+=("[$MODE] $*"); printf '  \033[31mFAIL\033[0m %s\n' "$*"; }
check() { local name=$1; shift; if "$@"; then ok "$name"; else bad "$name"; fi; }
is() { [ "$1" = "$2" ]; }
has() { grep -q -- "$2" <<<"$1"; }
jqe() { jq -e "$1" "$RESP" >/dev/null 2>&1; }
j() { jq -r "$1" "$RESP"; }

# api METHOD PATH [JSON]  -> $STATUS, body in $RESP, headers in $HDRS (uses $KEY, $BASE)
api() {
  local m=$1 p=$2 d=${3:-}
  cmd "curl -X $m $BASE$p${d:+ -d '$d'}"
  # content-type only with a body: Fastify rejects JSON content-type with an empty body
  STATUS=$(curl -s -m 180 -X "$m" -D "$HDRS" -o "$RESP" -w '%{http_code}' \
    -H "authorization: Bearer ${KEY:-}" ${d:+-H 'content-type: application/json' --data "$d"} "$BASE$p")
}
# chat CONV TEXT -> SSE stream in $SSE
chat() {
  cmd "curl -N -X POST $BASE/v1/conversations/$1/messages -d '{\"content\":\"$2\"}'"
  curl -s -N -m 180 -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
    -d "{\"content\":\"$2\"}" "$BASE/v1/conversations/$1/messages" >"$SSE"
}
sse_events() { grep '^event:' "$SSE" | cut -d' ' -f2 | tr '\n' ' ' | sed 's/ $//'; }
sse_data() { grep "^data:" "$SSE" | sed 's/^data: //' | jq -c "select(.type==\"$1\")" | tail -1; }

# start_gw ENV=VAL...  (logs in $WORK/gw-<mode>.log)
start_gw() {
  cmd "$* node dist/src/server.js"
  env "$@" node --env-file-if-exists=.env dist/src/server.js >>"$WORK/gw-$MODE.log" 2>&1 &
  GW_PID=$!
  for _ in $(seq 1 60); do curl -s -m 1 "$BASE/healthz" >/dev/null && return 0; sleep 0.25; done
  return 1
}
stop_gw() { [ -n "$GW_PID" ] && kill -INT "$GW_PID" 2>/dev/null && wait "$GW_PID" 2>/dev/null; GW_PID=""; }
trap 'stop_gw; rm -rf "$WORK"' EXIT

llm() { cmd "llm $*"; node cli/dist/index.js "$@" 2>&1; }

# ---------- features shared by both modes ----------
shared_features() {
  bold "[$MODE] Health"
  api GET /healthz; check "/healthz 200" is "$STATUS" 200
  check "/healthz says the mode" jqe ".mode == \"$MODE\""
  api GET /openapi.json; check "/openapi.json is an OpenAPI 3.1 document" jqe '.openapi == "3.1.0" and (.paths | length) > 10'
  api GET /readyz
  check "/readyz ok, db and ollama up" jqe '.ok and .db and .ollama'

  bold "[$MODE] Auth"
  local saved=$KEY
  KEY=""; api GET /v1/me
  check "no key -> 401 invalid_api_key" jqe '.error.code == "invalid_api_key"'
  KEY="llmgw_wrong"; api GET /v1/me; check "wrong key -> 401" is "$STATUS" 401
  KEY=$saved; api GET /v1/me
  check "GET /v1/me -> $EXPECT_EMAIL" jqe ".email == \"$EXPECT_EMAIL\""
  check "x-request-id header (req_...)" grep -qi '^x-request-id: req_' "$HDRS"

  bold "[$MODE] Models"
  api GET /v1/models; check "$MODEL listed as default" jqe ".data[] | select(.id == \"$MODEL\") | .default"
  api GET /v1/model; check "GET /v1/model" jqe ".id == \"$MODEL\""

  bold "[$MODE] Conversations: create, validate, rename"
  for i in 1 2 3 4 5; do api POST /v1/conversations "{\"title\":\"page $i\"}"; done
  check "create -> 201" is "$STATUS" 201
  api POST /v1/conversations '{"model":"not-a-model"}'
  if [ "$MODE" = single ]; then # allowed = installed: say what to download
    check "unknown model -> 400 model_not_installed + pull hint" jqe '.error.code == "model_not_installed" and .error.hint == "Run: ollama pull not-a-model"'
  else # server mode: the configured list
    check "unknown model -> 400 model_not_allowed" jqe '.error.code == "model_not_allowed"'
  fi
  api GET /v1/conversations/not-a-uuid; check "bad id -> 400" is "$STATUS" 400
  api POST /v1/conversations '{"title":"rename me"}'; local rid; rid=$(j .id)
  api PATCH "/v1/conversations/$rid" '{"title":"renamed"}'; check "PATCH renames" jqe '.title == "renamed"'

  bold "[$MODE] Cursor paging (limit=2 until nextCursor is null)"
  local cursor="" titles="" pages=0
  while :; do
    api GET "/v1/conversations?limit=2${cursor:+&cursor=$cursor}"
    titles+=$(j '.data[].title' | tr '\n' ',')
    cursor=$(j '.nextCursor // empty'); pages=$((pages + 1))
    [ -z "$cursor" ] || [ $pages -gt 20 ] && break
  done
  local seen; seen=$(tr ',' '\n' <<<"$titles" | grep -c '^page [1-5]$')
  check "all 5 'page' conversations seen once across $pages pages" is "$seen" 5
  check "no title repeated" is "$(tr ',' '\n' <<<"$titles" | grep -v '^$' | sort | uniq -d | wc -l | tr -d ' ')" 0
  api GET '/v1/conversations?cursor=garbage'; check "bad cursor -> 400 invalid_cursor" jqe '.error.code == "invalid_cursor"'

  bold "[$MODE] Chat over SSE (real Ollama)"
  api POST /v1/conversations '{"title":"e2e chat"}'; CONV=$(j .id)
  chat "$CONV" "Reply with exactly three words: hello from local"
  check "events: start delta... meta done" has "$(sse_events)" '^start delta.* meta done$'
  check "done.status complete" is "$(sse_data done | jq -r .status)" complete
  check "meta: provider ollama, contextBudget > 0" is "$(sse_data meta | jq -r '.provider + " " + (.contextBudget > 0 | tostring)')" "ollama true"
  chat "$CONV" "And now say goodbye in two words"
  api GET "/v1/conversations/$CONV"
  check "transcript: 4 messages user/assistant/user/assistant" is "$(j '[.messages[].role] | join(",")')" "user,assistant,user,assistant"
  check "seq strictly increasing" jqe '[.messages[].seq] as $s | $s == ($s | sort) and ($s | unique | length) == 4'
  check "title set from first message" jqe '.title == "e2e chat"'

  bold "[$MODE] Transcript paging"
  api GET "/v1/conversations/$CONV?limit=2"
  local after; after=$(j .nextAfter)
  check "page 1: 2 messages, messageCount 4, nextAfter set" jqe '(.messages | length) == 2 and .messageCount == 4 and .nextAfter != null'
  api GET "/v1/conversations/$CONV?limit=2&after=$after"
  check "page 2: last 2 messages, nextAfter null" jqe '(.messages | length) == 2 and .nextAfter == null'

  bold "[$MODE] Lease: one answer at a time per conversation"
  api POST /v1/conversations '{"title":"lease"}'; local lid; lid=$(j .id)
  cmd "(long answer in the background) + second message at once"
  curl -s -N -m 180 -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
    -d '{"content":"Write a 120 word story about a lighthouse."}' "$BASE/v1/conversations/$lid/messages" >"$WORK/long" &
  local bg=$!
  sleep 1
  api POST "/v1/conversations/$lid/messages" '{"content":"second"}'
  check "second message while busy -> 409 conversation_busy" jqe '.error.code == "conversation_busy"'
  wait $bg
  chat "$lid" "Say ok"
  check "after it finishes, the conversation is free again" is "$(sse_data done | jq -r .status)" complete

  bold "[$MODE] Partial answer when the client disconnects"
  api POST /v1/conversations '{"title":"partial"}'; local pid_conv; pid_conv=$(j .id)
  # Disconnect right after the first word arrives, not after a fixed time: a fast model can
  # finish a whole answer in under 3 s, and a finished answer is rightly saved as complete.
  cmd "curl .../messages -d '{\"content\":\"Count from 1 to 200 ...\"}'  (killed after the first delta)"
  curl -s -N -m 120 -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
    -d '{"content":"Count from 1 to 200, one number per line, with a word after each."}' \
    "$BASE/v1/conversations/$pid_conv/messages" >"$WORK/cut" 2>/dev/null &
  local cut=$!
  for _ in $(seq 1 120); do grep -q '^event: delta' "$WORK/cut" 2>/dev/null && break; sleep 0.25; done
  kill "$cut" 2>/dev/null; wait "$cut" 2>/dev/null
  sleep 1
  api GET "/v1/conversations/$pid_conv"
  check "cut-off answer saved with status partial" jqe '.messages[-1].role == "assistant" and .messages[-1].status == "partial"'

  bold "[$MODE] Fork (\"Try another way\")"
  api GET "/v1/conversations/$CONV"; local anchor; anchor=$(j '.messages[1].id')
  api POST "/v1/conversations/$CONV/forks" "{\"fromMessageId\":\"$anchor\",\"title\":\"branch\"}"
  FORK=$(j .id)
  check "fork -> 201, 2 messages copied, linked to parent" jqe ".messageCount == 2 and .parentConversationId == \"$CONV\""
  chat "$FORK" "Say the word branch"
  api GET "/v1/conversations/$FORK"; check "branch continues on its own (4 messages)" jqe '.messageCount == 4'
  api GET "/v1/conversations/$CONV"; check "parent unchanged (4 messages)" jqe '.messageCount == 4'
  api POST "/v1/conversations/$CONV/forks" '{"fromMessageId":"00000000-0000-4000-8000-000000000000"}'
  check "fork from unknown message -> 404" is "$STATUS" 404

  bold "[$MODE] Stats"
  api GET /v1/stats
  local before; before=$(j ".models[] | select(.model == \"$MODEL\") | .requests")
  check "stats for $MODEL: requests >= 6, p50 TTFT and tok/s reported" \
    jqe ".models[] | select(.model == \"$MODEL\") | .requests >= 6 and .p50TtftMs != null and .avgTokPerSec != null"
  check "partial counted" jqe ".models[] | select(.model == \"$MODEL\") | .partial >= 1"

  bold "[$MODE] Delete keeps the branch and the usage history"
  api DELETE "/v1/conversations/$CONV"; check "DELETE -> 204" is "$STATUS" 204
  api GET "/v1/conversations/$CONV"; check "deleted -> 404" jqe '.error.code == "conversation_not_found"'
  api GET "/v1/conversations/$FORK"; check "branch survives, detached" jqe '.parentConversationId == null and .messageCount == 4'
  api GET /v1/stats; check "stats unchanged after delete ($before requests)" jqe ".models[] | select(.model == \"$MODEL\") | .requests == $before"

  bold "[$MODE] Legacy /v1/chat/completions"
  api POST /v1/chat/completions "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Say hi\"}]}"
  check "non-stream -> 200 with a reply" jqe '.choices[0].message.content | length > 0'
  cmd "curl ... /v1/chat/completions (stream)"
  curl -s -N -m 120 -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
    -d "{\"model\":\"$MODEL\",\"stream\":true,\"messages\":[{\"role\":\"user\",\"content\":\"Say hi\"}]}" \
    "$BASE/v1/chat/completions" >"$SSE"
  check "stream ends with [DONE]" grep -q 'data: \[DONE\]' "$SSE"
}

cli_features() {
  bold "[$MODE] CLI"
  local out
  out=$(llm whoami); echo "$out" | sed 's/^/    /'; check "llm whoami -> $EXPECT_EMAIL" has "$out" "$EXPECT_EMAIL"
  cmd "llm doctor --json"; out=$(node cli/dist/index.js doctor --json 2>&1); check "llm doctor --json: ok, database checked" bash -c 'jq -e ".ok and any(.checks[]; .id == \"database\" and .status == \"ok\")" <<<"$1" >/dev/null' _ "$out"
  if [ "$MODE" = server ]; then
    out=$(llm backup); check "llm backup in server mode points to pg_dump" has "$out" "pg_dump"
  fi
  out=$(llm models); check "llm models lists $MODEL as default" has "$out" "$MODEL  (server default)"
  out=$(llm chat -q -t "cli chat" "Reply with exactly: cli works"); echo "$out" | sed 's/^/    /'
  check "llm chat (one-shot) answers" test -n "$out"
  out=$(llm conversations -n 3); echo "$out" | sed 's/^/    /'; check "llm conversations shows 'cli chat'" has "$out" "cli chat"
  out=$(llm show latest); check "llm show latest prints the transcript" has "$out" "cli works"
  out=$(llm fork latest -t "cli branch"); check "llm fork latest" has "$out" "cli branch"
  out=$(llm rename latest cli renamed); check "llm rename latest" test $? -eq 0
  out=$(llm conversations -n 1); check "renamed branch is newest" has "$out" "cli renamed"
  out=$(llm stats); check "llm stats shows $MODEL" has "$out" "$MODEL"
  out=$(llm rm latest -y); check "llm rm latest -y" test $? -eq 0
}

ratelimit_check() { # KEY must be fresh for this gateway; gateway runs with RATE_LIMIT_MAX=3
  local codes=""
  for _ in 1 2 3 4; do api GET /v1/conversations; codes+="$STATUS "; done
  check "4 requests with RATE_LIMIT_MAX=3 -> 200 200 200 429" is "$codes" "200 200 200 429 "
  check "429 body is rate_limited" jqe '.error.code == "rate_limited"'
}

# =====================================================================
MODE=single
BASE=http://localhost:$SINGLE_PORT
DATA=$WORK/single-data
export XDG_CONFIG_HOME=$WORK/cli-single DATA_DIR=$DATA LLM_BASE_URL=$BASE
# Model settings emptied: single-user mode discovers installed models and picks the default.
SINGLE_ENV=(DATABASE_URL= REDIS_URL= ALLOWED_MODELS= DEFAULT_MODEL= DATA_DIR="$DATA" PORT=$SINGLE_PORT RATE_LIMIT_MAX=1000 LOG_LEVEL=info)
bold "================ SINGLE-USER MODE (SQLite, no Docker) ================"

bold "[$MODE] First start: data folder, database, local key"
check "data folder does not exist yet" test ! -e "$DATA"
start_gw "${SINGLE_ENV[@]}"; check "gateway starts" test $? -eq 0
check "log: mode single, sqlite, memory rate limit" grep -q '"mode":"single","storage":"sqlite".*"rateLimit":"memory"' "$WORK/gw-single.log"
check "log: created a local API key" grep -q 'created a local API key for the CLI' "$WORK/gw-single.log"
sleep 1 # the model check runs right after listen
check "log: model picked to fit memory" grep -q "Model $MODEL is ready: needs about .* of .* GB" "$WORK/gw-single.log"
check "folder is 0700" is "$(stat -f %Lp "$DATA")" 700
check "gateway.db is 0600" is "$(stat -f %Lp "$DATA/gateway.db")" 600
check "local-credentials.json is 0600" is "$(stat -f %Lp "$DATA/local-credentials.json")" 600
check "lock file holds the gateway PID" is "$(jq -r .pid "$DATA/gateway.lock")" "$GW_PID"
KEY=$(jq -r .apiKey "$DATA/local-credentials.json")
EXPECT_EMAIL=local@localhost

bold "[$MODE] CLI with NO config and NO key (zero-config)"
out=$(llm config show); echo "$out" | sed 's/^/    /'
check "config show: key from the gateway on this computer" has "$out" "from the gateway on this computer"
out=$(LLM_BASE_URL=http://127.0.0.1:$SINGLE_PORT node cli/dist/index.js whoami 2>&1)
cmd "LLM_BASE_URL=http://127.0.0.1:$SINGLE_PORT llm whoami"
check "127.0.0.1 counts as the same local gateway" has "$out" "local@localhost"
out=$(LLM_BASE_URL=http://localhost:9 node cli/dist/index.js whoami 2>&1)
cmd "LLM_BASE_URL=http://localhost:9 llm whoami"
check "key not sent to another port (asks for a key instead)" has "$out" "No API key configured"

bold "[$MODE] llm doctor"
out=$(llm doctor); code=$?; echo "$out" | sed 's/^/    /'
check "doctor: all good, exit 0" bash -c "[ $code -eq 0 ] && grep -q 'All good' <<<\"\$1\"" _ "$out"
check "doctor: gateway's own checks included (model, database)" has "$out" "The database (SQLite) is up to date"
out=$(LLM_BASE_URL=http://localhost:9 node cli/dist/index.js doctor 2>&1); code=$?
cmd "LLM_BASE_URL=http://localhost:9 llm doctor"
check "doctor with the gateway down: exit 1, says how to start it" bash -c "[ $code -eq 1 ] && grep -q 'npm start' <<<\"\$1\"" _ "$out"

shared_features
cli_features

bold "[$MODE] One gateway per data folder"
cmd "PORT=3989 (same DATA_DIR) node dist/src/server.js"
out=$(env "${SINGLE_ENV[@]}" PORT=3989 node --env-file-if-exists=.env dist/src/server.js 2>&1); code=$?
echo "    $out"
check "second gateway refused with a plain message, exit 1" bash -c "[ $code = 1 ] && grep -q 'Another gateway is already using this data folder' <<<\"\$0\"" "$out"
cmd "DATA_DIR=<other> PORT=$SINGLE_PORT node dist/src/server.js"
out=$(env "${SINGLE_ENV[@]}" DATA_DIR="$WORK/other" node --env-file-if-exists=.env dist/src/server.js 2>&1 | grep -v '^{')
echo "    $out"
check "port in use -> plain message" has "$out" "Port $SINGLE_PORT is already in use"
check "...and no lock left behind" test ! -e "$WORK/other/gateway.lock"

bold "[$MODE] History survives a restart"
api GET '/v1/conversations?limit=100'; count_before=$(j '.data | length')
stop_gw; check "Ctrl+C removes the lock" test ! -e "$DATA/gateway.lock"
start_gw "${SINGLE_ENV[@]}"
api GET '/v1/conversations?limit=100'; check "same $count_before conversations after restart" jqe ".data | length == $count_before"
check "same key after restart" is "$(jq -r .apiKey "$DATA/local-credentials.json")" "$KEY"

bold "[$MODE] Backup and restore"
cmd "llm backup --json"; out=$(node cli/dist/index.js backup --json 2>&1); BACKUP=$(jq -r .file <<<"$out")
check "llm backup writes a file under backups/" test -f "$BACKUP"
check "backup holds all $count_before conversations" bash -c "jq -e '.conversations == $count_before' <<<\"\$1\" >/dev/null" _ "$out"
check "backup file is 0600" is "$(stat -f %Lp "$BACKUP")" 600
out=$(env "${SINGLE_ENV[@]}" npx tsx scripts/restore.ts "$BACKUP" 2>&1); cmd "npm run restore -- <backup>   (gateway running)"
check "restore refuses while the assistant runs" has "$out" "The assistant is running. Stop it first"
api POST /v1/conversations '{"title":"made after the backup"}'
stop_gw
out=$(env "${SINGLE_ENV[@]}" npx tsx scripts/restore.ts "$BACKUP" 2>&1); cmd "npm run restore -- <backup>"; echo "    $out"
check "restore reports the conversations" has "$out" "Restored $count_before conversations"
check "the replaced database is kept" bash -c 'ls "$1"/backups/before-restore-*.db >/dev/null 2>&1' _ "$DATA"
start_gw "${SINGLE_ENV[@]}"
api GET '/v1/conversations?limit=100'; check "after restore: the $count_before conversations from the backup" jqe ".data | length == $count_before"

bold "[$MODE] Crash recovery (kill -9)"
cmd "kill -9 <gateway>"; kill -9 "$GW_PID"; wait "$GW_PID" 2>/dev/null; GW_PID=""
check "lock left behind by the crash" test -e "$DATA/gateway.lock"
start_gw "${SINGLE_ENV[@]}"; check "next start takes over the stale lock" is "$(jq -r .pid "$DATA/gateway.lock")" "$GW_PID"
api GET '/v1/conversations?limit=100'; check "data intact after crash" jqe ".data | length == $count_before"

bold "[$MODE] Lost key file -> new key, old key revoked"
stop_gw; cmd "rm local-credentials.json"; rm "$DATA/local-credentials.json"
start_gw "${SINGLE_ENV[@]}"
NEW=$(jq -r .apiKey "$DATA/local-credentials.json")
check "a new key was issued" test "$NEW" != "$KEY"
api GET /v1/me; check "old key -> 401" is "$STATUS" 401
KEY=$NEW; api GET /v1/me; check "new key works" is "$STATUS" 200
out=$(llm whoami); check "CLI picks up the new key by itself" has "$out" "local@localhost"

bold "[$MODE] Unsafe file permissions"
cmd "chmod 644 local-credentials.json"; chmod 644 "$DATA/local-credentials.json"
out=$(llm whoami); echo "    $out"
check "CLI refuses the key and explains chmod 600" has "$out" "chmod 600"
chmod 600 "$DATA/local-credentials.json"

bold "[$MODE] In-memory rate limit"
stop_gw; start_gw "${SINGLE_ENV[@]}" RATE_LIMIT_MAX=3
ratelimit_check
stop_gw

# =====================================================================
MODE=server
BASE=http://localhost:$SERVER_PORT
export XDG_CONFIG_HOME=$WORK/cli-server DATA_DIR=$WORK/server-data LLM_BASE_URL=
SERVER_ENV=(DATABASE_URL=$SERVER_DB REDIS_URL=$REDIS DATA_DIR="$WORK/server-data" PORT=$SERVER_PORT RATE_LIMIT_MAX=1000 LOG_LEVEL=info)
bold "================ SERVER MODE (Postgres + Redis) ================"

bold "[$MODE] Migrate and create keys"
cmd "docker exec postgres psql: empty the llmgw_test tables"
docker exec local-llm-gateway-postgres-1 psql -q -U llmgw -d llmgw_test \
  -c 'truncate table generations, messages, conversations, api_keys, users restart identity cascade' >/dev/null 2>&1
cmd "DATABASE_URL=$SERVER_DB npm run db:migrate"
out=$(DATABASE_URL=$SERVER_DB npm run -s db:migrate 2>&1); check "db:migrate" has "$out" "migrations applied"
newkey() { DATABASE_URL=$SERVER_DB npm run -s key:create -- "$1" 2>/dev/null | awk '/api key:/ {print $3}'; }
cmd "npm run key:create -- a@e2e.test"; KEY=$(newkey a@e2e.test); check "key:create prints a key" has "$KEY" "llmgw_"
cmd "npm run key:create -- b@e2e.test"; KEY_B=$(newkey b@e2e.test)
EXPECT_EMAIL=a@e2e.test

start_gw "${SERVER_ENV[@]}"; check "gateway starts" test $? -eq 0
check "log: mode server, postgres, redis rate limit" grep -q '"mode":"server","storage":"postgres","rateLimit":"redis"' "$WORK/gw-server.log"
check "log never contains DATABASE_URL" bash -c "! grep -q 'llmgw:llmgw@' '$WORK/gw-server.log'"
check "no local key file in server mode" test ! -e "$WORK/server-data/local-credentials.json"

bold "[$MODE] CLI with a profile (key from stdin)"
cmd "echo \$KEY | llm profile add srv --base-url $BASE --api-key-stdin"
echo "$KEY" | node cli/dist/index.js profile add srv --base-url "$BASE" --api-key-stdin >/dev/null 2>&1
out=$(llm profile current); check "profile srv active" has "$out" "srv"

shared_features
cli_features

bold "[$MODE] Users are isolated"
api POST /v1/conversations '{"title":"private to a"}'; private=$(j .id)
saved=$KEY; KEY=$KEY_B
api GET "/v1/conversations/$private"; check "user b gets 404 on user a's conversation" is "$STATUS" 404
api GET /v1/stats; check "user b's stats are empty" jqe '.models | length == 0'
KEY=$saved

bold "[$MODE] A key is never sent to a gateway it was not saved for"
out=$(LLM_BASE_URL=http://other.example.com node cli/dist/index.js whoami 2>&1)
cmd "LLM_BASE_URL=http://other.example.com llm whoami"; echo "    $(head -1 <<<"$out")"
check "saved key withheld for another gateway" has "$out" "saved API key was not sent there"

bold "[$MODE] Revoked key"
cmd "npm run key:create -- c@e2e.test; psql: set revoked_at"
KEY_C=$(newkey c@e2e.test)
docker exec local-llm-gateway-postgres-1 psql -q -U llmgw -d llmgw_test \
  -c "update api_keys set revoked_at = now() where user_id = (select id from users where email = 'c@e2e.test')" >/dev/null
saved=$KEY; KEY=$KEY_C; api GET /v1/me; check "revoked key -> 401" is "$STATUS" 401; KEY=$saved

bold "[$MODE] Redis rate limit"
stop_gw; start_gw "${SERVER_ENV[@]}" RATE_LIMIT_MAX=3
cmd "npm run key:create -- d@e2e.test  (fresh key: Redis keeps counters across restarts)"
KEY=$(newkey d@e2e.test)
ratelimit_check
cmd "docker exec redis redis-cli --scan --pattern 'llmgw:*'"
check "counters live in Redis" test -n "$(docker exec local-llm-gateway-redis-1 redis-cli --scan --pattern 'llmgw:*' | head -1)"
stop_gw

# =====================================================================
bold "================ RESULT ================"
printf '  %s passed, %s failed\n' "$PASS" "$FAIL"
for f in ${FAILS[@]+"${FAILS[@]}"}; do printf '  \033[31m- %s\033[0m\n' "$f"; done
[ "$FAIL" -eq 0 ]
