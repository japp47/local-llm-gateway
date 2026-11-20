# Phase 1a gate walk (by hand)

Phase 1a is done when someone with only Node and Ollama gets an answer with one command and
no key setup, `llm doctor` explains the two common problems, and a backup comes back in a
fresh data folder. The automated e2e script approximates this with temp folders; this walk
is the honest version, on a clean account, the way a newcomer would meet it.

Write down **everything that confused you or needed a second try**, even if it worked in
the end. Those notes are the input for Phase 1b (installer and web chat).

## 0. Prepare a clean account (about 5 minutes)

1. System Settings → Users & Groups → Add User: a standard user, for example `gatewalk`.
2. Log out, log in as `gatewalk`. Check that it is clean:
   ```bash
   ls ~/.config/llm-gateway ~/Library/Application\ Support/llm-gateway   # both: No such file
   which node ollama                                                     # both found
   ```
   Node and Ollama are installed for the whole machine; models are per user (in `~/.ollama`),
   so this account has none. That is realistic: it is a first run.

## 1. Single-user mode: first answer, no setup

Start a timer.

```bash
open -a Ollama                      # or: ollama serve, in its own window
git clone https://github.com/japp47/local-llm-gateway.git && cd local-llm-gateway
npm ci && npm run build
npm start
```

- [ ] The log names the model to download (no model yet), and the gateway keeps running.
- [ ] Download it (the exact command is in the log), e.g. `ollama pull qwen3:8b`.

In a second window:

```bash
cd local-llm-gateway/cli && npm ci && npm run build && npm install -g .
llm chat "Say hello in five words"
```

- [ ] An answer arrives. No key was typed anywhere.
- [ ] Time to first answer, not counting the model download: ______ min
- [ ] If `npm install -g .` fails with a permissions error (Homebrew's folder belongs to
      the other user), write it down, then use `alias llm="node $PWD/dist/index.js"`.
      That is a real finding: the installer must not need it.

Then:

- [ ] `llm doctor` → every line ✓, "All good."
- [ ] Restart: Ctrl+C the gateway, `npm start` again, `llm ls` → the conversation is still there.

## 2. `llm doctor` explains the two common problems

- [ ] Quit Ollama (menu bar → Quit). `llm doctor` → ✗ "Ollama isn't running." with the fix.
      `llm chat "hi"` → the same plain message, not an error code.
- [ ] Start Ollama again. `ollama rm <the model>`. `llm doctor` → ✗ no chat model, with the
      exact `ollama pull` command. Pull it again.
- [ ] Stop the gateway. `llm doctor` → ✗ "The assistant isn't running", with how to start it.

## 3. Backup restored into a fresh data folder

```bash
llm backup                          # note the file path it prints
```

Keep the gateway running for this: the restore goes into a different folder.

```bash
DATA_DIR=~/restore-test npm run restore -- <the backup file>
DATA_DIR=~/restore-test PORT=3001 npm start            # in another window
DATA_DIR=~/restore-test LLM_BASE_URL=http://localhost:3001 llm ls
```

- [ ] The restore prints the number of conversations it brought back.
- [ ] `llm ls` on port 3001 shows the same conversations as on port 3000.
- [ ] `npm run restore` while that gateway runs → refused: "The assistant is running. Stop it first".

## 4. Server mode (your normal account is fine: it needs Docker)

```bash
docker compose up -d postgres redis
cp .env.example .env
npm run db:migrate
npm run key:create -- you@example.com
npm start
llm profile add home                # paste the key when asked
llm profile use home
llm chat "hello"
llm doctor                          # (server mode) in the gateway line
llm backup                          # points to pg_dump instead
```

- [ ] All of the above work.
- [ ] Switch back to single-user (`npm run dev:single`) while profile `home` is active:
      `llm chat` explains the key is for the other mode and names the profile to use.

## 5. Results

| Check | Pass? | Notes |
| --- | --- | --- |
| First answer, no key setup | | |
| Time to first answer (excluding download) | | |
| Restart keeps history | | |
| Doctor: Ollama not running | | |
| Doctor: model missing | | |
| Doctor: gateway down | | |
| Backup restored in a fresh folder | | |
| Server mode works | | |
| Things that confused me | | |

## Runs

- 2026-11-20, same account (fresh clone, separate `DATA_DIR`, `XDG_CONFIG_HOME`, port 3005):
  all checks passed; first answer within seconds of `llm chat`. Not covered: a first model
  download, a second macOS account.

When done: delete the `gatewalk` user (System Settings → Users & Groups) and `~/restore-test`.
