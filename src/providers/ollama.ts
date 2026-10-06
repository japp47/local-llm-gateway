import type { ChatEvent, ChatRequest, LLMProvider } from './types.js';
import { ProviderError } from './types.js';

interface ChunkJson {
  choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

/** Pure parser for one SSE line from an OpenAI-compatible stream. */
export function parseSseLine(line: string): ChatEvent[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return [];
  const data = trimmed.slice(5).trim();
  if (!data || data === '[DONE]') return [];

  let json: ChunkJson;
  try {
    json = JSON.parse(data) as ChunkJson;
  } catch {
    return [];
  }

  const events: ChatEvent[] = [];
  const choice = json.choices?.[0];
  if (choice?.delta?.content) events.push({ type: 'delta', text: choice.delta.content });
  if (choice?.finish_reason) events.push({ type: 'done', finishReason: choice.finish_reason });
  if (json.usage) {
    events.push({
      type: 'usage',
      promptTokens: json.usage.prompt_tokens ?? 0,
      completionTokens: json.usage.completion_tokens ?? 0,
    });
  }
  return events;
}

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';

  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async *chat(req: ChatRequest): AsyncGenerator<ChatEvent> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        stream: true,
        stream_options: { include_usage: true },
        temperature: req.temperature,
        max_tokens: req.maxTokens,
      }),
      signal: req.signal,
    });

    if (!res.ok || !res.body) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      throw new ProviderError(`ollama responded ${res.status}`, res.status, detail);
    }

    const decoder = new TextDecoder();
    let buf = '';
    let finished = false;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        for (const ev of parseSseLine(line)) {
          if (ev.type === 'done') finished = true;
          yield ev;
        }
      }
    }
    for (const ev of parseSseLine(buf)) {
      if (ev.type === 'done') finished = true;
      yield ev;
    }
    if (!finished) yield { type: 'done', finishReason: null };
  }
}