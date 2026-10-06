export const CONFIG_KEYS = ['baseUrl', 'apiKey', 'model'] as const
export const DEFAULT_BASE_URL = 'http://localhost:3000';
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PREFIX_RE = /^[0-9a-f-]{4,}$/i;

export const HELP = `Commands:
  /help              show this help
  /exit              leave (Ctrl-D also works)
  /model [name]      show or change the model for your next messages
  /history [n]       show the last n messages (default 10), numbered
  /fork [n]          branch from message n (default: last assistant reply) and switch to it
  /switch <id>       switch to another conversation (id, prefix, or "latest")
  /title <text>      rename this conversation
  /info              details of the last reply (tokens, speed, context)
  /id                print this conversation's id
Ctrl-C while a reply is streaming cancels it (the partial reply is kept).`;