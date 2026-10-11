# llm: command-line client for the gateway

```bash
cd cli && npm install && npm run build
node dist/index.js --help        # or: npm run dev -- --help
```

## Profiles

A profile is a local alias on your machine for **gateway URL + API key + default model**. The gateway does not know your profile names.

```bash
llm profile add personal                 # asks for the API key (input hidden); gateway defaults to http://localhost:3000
llm profile add work --base-url https://gateway.example.com
llm profile list                         # * marks the active profile; keys are masked
llm profile use work
llm profile current                      # what is in effect, and where each value comes from
llm profile remove personal              # refuses to remove the active profile; --force removes it and leaves none active
llm whoami                               # asks the gateway who this key belongs to
```

Giving the key without the prompt:

```bash
printf %s "$KEY" | llm profile add ci --api-key-stdin   # keeps it out of shell history
llm profile add ci --api-key "$KEY"                     # works, but the key is visible in history and `ps`
```

### Safety rules the CLI follows

- A new profile never inherits the URL of the active profile or of `LLM_BASE_URL`; it uses `--base-url` or `http://localhost:3000`, and prints which.
- If `LLM_BASE_URL` points at a **different** gateway than the saved one and `LLM_API_KEY` is not set, the saved key is not sent. You get a message instead. Set `LLM_API_KEY` for that gateway, or unset `LLM_BASE_URL`.
- If the active profile has been deleted from the file, commands stop with a clear message instead of quietly using old flat settings.
- Removing the active profile never silently activates another one.
- The config file is written atomically (temp file, then rename) with mode `0600`.
- Profile names are letters, numbers, `.`, `_`, `-` (max 32); `constructor` and `prototype` are reserved.

### Where settings come from

Environment variables beat the active profile, which beats the legacy flat settings.

| Variable | Overrides |
| --- | --- |
| `LLM_BASE_URL` | gateway URL |
| `LLM_API_KEY` | API key |
| `LLM_MODEL` | default model |
| `XDG_CONFIG_HOME` | where `llm-gateway/config.json` lives |

`llm config show` prints the effective values and marks the ones that came from the environment. `llm config set apiKey` with no value prompts for the key.

## Other commands

`chat`, `resume`, `conversations` (`ls`), `show`, `fork`, `rename`, `rm`, `models`, `stats`: run `llm <command> --help`. Long conversations are fetched page by page, so `show`, `resume` and fork message numbers always cover the whole transcript.
