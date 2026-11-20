// After a model answers for the first time, ask Ollama how it was actually loaded
// (/api/ps) and warn about the two things that silently hurt: part of the model running on
// the CPU (roughly 10x slower answers), and a context size different from what the gateway
// plans for. Facts from Ollama, not guesses.
import type { LoadedModel } from '../providers/ollama-models.js';
import { normalizeName } from './model-picker.js';

export function fitWarnings(loaded: LoadedModel | undefined, expectedContext: number): string[] {
  if (!loaded) return [];
  const out: string[] = [];
  if (loaded.sizeBytes > 0 && loaded.vramBytes < loaded.sizeBytes) {
    const pct = Math.round((loaded.vramBytes / loaded.sizeBytes) * 100);
    out.push(
      `${loaded.name} doesn't fully fit in GPU memory (${pct}% on the GPU), so answers will be slow. A smaller model would be faster (see: llm models).`,
    );
  }
  if (loaded.contextLength && loaded.contextLength !== expectedContext) {
    // Ollama picks its own context size by GPU memory; the OpenAI-compatible API can't set it.
    out.push(
      `Ollama gave ${loaded.name} a ${loaded.contextLength}-token context, but the gateway plans for ${expectedContext} (MODEL_CONTEXT_TOKENS). Memory use won't match the estimate.`,
    );
  }
  return out;
}

/** Returns a callback that checks each model once per process, in the background. */
export function makeFitChecker(
  source: { loaded(): Promise<LoadedModel[]> },
  expectedContext: number,
  warn: (msg: string) => void,
): (model: string) => void {
  const checked = new Set<string>();
  return (model) => {
    const key = normalizeName(model);
    if (checked.has(key)) return;
    checked.add(key);
    source
      .loaded()
      .then((all) => {
        for (const msg of fitWarnings(all.find((m) => normalizeName(m.name) === key), expectedContext)) warn(msg);
      })
      .catch(() => checked.delete(key)); // try again next time
  };
}
