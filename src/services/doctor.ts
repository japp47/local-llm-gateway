// Health checks shared by startup (logged) and `GET /v1/doctor` (shown by `llm doctor`).
// Each check says what is wrong in plain words and what to do. Nothing here throws:
// a failing dependency is a result, not an error.
import type { InstalledModel, LoadedModel } from '../providers/ollama-models.js';
import { ProviderError } from '../providers/types.js';
import { fitWarnings } from './model-fit.js';
import { gb, normalizeName } from './model-picker.js';
import type { ModelsService } from './models.service.js';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface Check {
  id: string;
  status: CheckStatus;
  message: string;
  hint?: string;
}

export interface OllamaInfo {
  version(): Promise<string>;
  installed(): Promise<InstalledModel[]>;
  loaded(): Promise<LoadedModel[]>;
}

const fromError = (id: string, err: unknown): Check => {
  if (err instanceof ProviderError) return { id, status: 'fail', message: err.message, ...(err.hint ? { hint: err.hint } : {}) };
  return { id, status: 'fail', message: `Unexpected problem: ${(err as Error).message}` };
};

export async function ollamaCheck(ollama: OllamaInfo): Promise<Check> {
  try {
    return { id: 'ollama', status: 'ok', message: `Ollama ${await ollama.version()} is running.` };
  } catch (err) {
    return fromError('ollama', err);
  }
}

/** Is there a chat model to answer with, and does it fit? Assumes Ollama answered. */
export async function modelCheck(models: ModelsService, ollama: OllamaInfo, defaultModel: string | undefined): Promise<Check> {
  const id = 'model';
  try {
    if (defaultModel) {
      const installed = await ollama.installed();
      return installed.some((m) => normalizeName(m.name) === normalizeName(defaultModel))
        ? { id, status: 'ok', message: `Model ${defaultModel} is downloaded (set by DEFAULT_MODEL).` }
        : { id, status: 'fail', message: `The default model ${defaultModel} isn't downloaded yet.`, hint: `Run: ollama pull ${defaultModel}` };
    }
    const pick = await models.describePick();
    switch (pick.kind) {
      case 'picked':
        return {
          id,
          status: 'ok',
          message: `Model ${pick.model} is ready: needs about ${gb(pick.needBytes)} of ${gb(pick.budgetBytes)} GB${pick.why === 'largest_that_fits' ? ' (the largest that fits)' : ''}.`,
        };
      case 'none_installed':
        return { id, status: 'fail', message: 'No chat model is downloaded yet.', hint: `Run: ollama pull ${pick.suggestion}` };
      case 'none_fit':
        return {
          id,
          status: 'fail',
          message: `The downloaded models need more memory than this computer can spare (${pick.smallest.model} needs about ${gb(pick.smallest.needBytes)} of ${gb(pick.budgetBytes)} GB).`,
          hint: `Download a smaller one: ollama pull ${pick.suggestion}`,
        };
    }
  } catch (err) {
    return fromError(id, err);
  }
}

/** Only says something once the model has been loaded (after a first answer). */
export async function fitCheck(ollama: OllamaInfo, model: string, expectedContext: number): Promise<Check | null> {
  try {
    const loaded = (await ollama.loaded()).find((m) => normalizeName(m.name) === normalizeName(model));
    const warnings = fitWarnings(loaded, expectedContext);
    if (!loaded) return null;
    if (warnings.length === 0) return { id: 'fit', status: 'ok', message: `${model} is loaded and fully on the GPU.` };
    return { id: 'fit', status: 'warn', message: warnings.join(' ') };
  } catch {
    return null;
  }
}

export async function databaseCheck(
  storage: { ping(): Promise<boolean>; migrationStatus(): Promise<{ applied: number; available: number }> },
  mode: 'single' | 'server',
): Promise<Check> {
  const id = 'database';
  const kind = mode === 'single' ? 'SQLite' : 'Postgres';
  if (!(await storage.ping())) {
    return {
      id,
      status: 'fail',
      message: `The database (${kind}) isn't answering.`,
      hint: mode === 'server' ? 'Check that Postgres is running: docker compose up -d postgres' : 'Restart the assistant.',
    };
  }
  try {
    const { applied, available } = await storage.migrationStatus();
    if (applied < available) {
      return {
        id,
        status: 'fail',
        message: `The database needs an update (${applied} of ${available} changes applied).`,
        hint: mode === 'server' ? 'Run: npm run db:migrate' : 'Restart the assistant; it updates the database when it starts.',
      };
    }
    if (applied > available) {
      return {
        id,
        status: 'warn',
        message: 'The database was updated by a newer version of the assistant.',
        hint: 'Update the assistant to the latest version.',
      };
    }
    return { id, status: 'ok', message: `The database (${kind}) is up to date.` };
  } catch (err) {
    return fromError(id, err);
  }
}

/** Everything the gateway can check about itself. */
export async function gatewayChecks(d: {
  mode: 'single' | 'server';
  models: ModelsService;
  ollama: OllamaInfo;
  defaultModel: string | undefined;
  contextTokens: number;
  storage: Parameters<typeof databaseCheck>[0];
}): Promise<Check[]> {
  const checks: Check[] = [await ollamaCheck(d.ollama)];
  if (checks[0]!.status === 'ok') {
    const model = await modelCheck(d.models, d.ollama, d.defaultModel);
    checks.push(model);
    const name = d.defaultModel ?? (model.status === 'ok' ? (await d.models.getDefault().catch(() => null))?.id : undefined);
    const fit = name ? await fitCheck(d.ollama, name, d.contextTokens) : null;
    if (fit) checks.push(fit);
  }
  checks.push(await databaseCheck(d.storage, d.mode));
  return checks;
}
