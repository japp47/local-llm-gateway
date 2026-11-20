// The one place that turns Ollama's failures into codes and plain-language messages.
// The CLI, the future web app and `llm doctor` all show what is decided here.
import { ProviderError } from './types.js';

const UNREACHABLE = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

export const ollamaUnavailable = (detail?: string) =>
  new ProviderError(
    'ollama_unavailable',
    "Ollama isn't running.",
    'Open the Ollama app (or run: ollama serve), then try again.',
    detail,
  );

export const modelNotInstalled = (model: string, detail?: string) =>
  new ProviderError(
    'model_not_installed',
    `The model ${model} isn't downloaded yet.`,
    `Run: ollama pull ${model}`,
    detail,
  );

/** `fetch` threw before any response: Ollama is down, or the URL is wrong. */
export function classifyFetchFailure(err: unknown): ProviderError {
  const e = err as { name?: string; message?: string; cause?: { code?: string } };
  const code = e.cause?.code;
  if (e.name === 'TimeoutError' || (code && UNREACHABLE.has(code)) || e.message === 'fetch failed') {
    return ollamaUnavailable(code ?? e.message);
  }
  return new ProviderError('provider_error', 'Could not talk to Ollama.', undefined, e.message);
}

/** Ollama answered with an error status before streaming anything. */
export function classifyHttpFailure(status: number, body: string, model: string): ProviderError {
  const detail = `HTTP ${status}: ${body.slice(0, 300)}`;
  if (status === 404 || /not_found_error|not found/i.test(body)) return modelNotInstalled(model, detail);
  // Ollama checks memory before loading: "model requires more system memory (X) than is available (Y)"
  if (/more system memory|out of memory|insufficient memory|not enough memory/i.test(body)) {
    return new ProviderError(
      'model_too_large',
      `The model ${model} needs more memory than is free right now.`,
      'Close some apps, or choose a smaller model (see: llm models).',
      detail,
    );
  }
  return new ProviderError('provider_error', `Ollama could not answer (error ${status}).`, undefined, detail);
}

/** The stream broke after it started. Whatever arrived is saved by the caller. */
export function classifyStreamFailure(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  return new ProviderError(
    'model_stopped',
    'The model stopped unexpectedly.',
    'Try again. If it keeps happening, restart Ollama.',
    (err as Error)?.message,
  );
}
