import { config } from '../config.js';

export async function ollamaReady(): Promise<boolean> {
  try {
    const r = await fetch(`${config.OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    return r.ok;
  } catch {
    return false;
  }
}