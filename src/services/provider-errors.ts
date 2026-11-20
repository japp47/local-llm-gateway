import { AppError } from '../lib/errors.js';
import type { ProviderError, ProviderErrorCode } from '../providers/types.js';

/** HTTP status for a provider failure that happens before the stream starts. */
const STATUS: Record<ProviderErrorCode, number> = {
  ollama_unavailable: 503, // temporary: start Ollama and retry
  model_too_large: 503, // temporary: free memory and retry
  model_not_installed: 400, // the request names a model this machine doesn't have
  model_stopped: 502,
  provider_error: 502,
};

export const fromProviderError = (e: ProviderError) =>
  new AppError(STATUS[e.code], e.code, e.message, { hint: e.hint });
