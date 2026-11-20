import { AppError } from '../lib/errors.js';
import { modelNotInstalled } from '../providers/ollama-errors.js';
import type { InstalledModel } from '../providers/ollama-models.js';
import { ProviderError } from '../providers/types.js';
import { canChat, gb, normalizeName, pickModel, type PickResult } from './model-picker.js';
import { fromProviderError } from './provider-errors.js';

export interface ModelInfo {
  id: string;
  default: boolean;
}

export interface ModelSource {
  installed(): Promise<InstalledModel[]>;
}

export interface ModelsOptions {
  /** ALLOWED_MODELS. Unset: whatever chat models Ollama has installed. */
  allowed?: string[];
  /** DEFAULT_MODEL. Unset: picked to fit this machine (model-picker.ts). */
  defaultModel?: string;
  /** Needed when either setting is unset. */
  source?: ModelSource;
  totalMemoryBytes: number;
  contextTokens: number;
  /** How long the installed list is reused. A miss always re-checks, so `ollama pull` works at once. */
  cacheMs?: number;
  now?: () => number;
}

/**
 * Which models may be used, and which one is the default.
 * - Both settings given (server mode, tests): a fixed list, exactly as configured.
 * - Otherwise (single-user mode): asks Ollama what is installed, and settings still win.
 */
export class ModelsService {
  private cache?: { at: number; models: Promise<InstalledModel[]> };

  constructor(private readonly o: ModelsOptions) {
    if (!this.fixed && !o.source) throw new Error('ModelsService: a model source is needed to discover models');
  }

  /** Nothing to discover: the configuration lists the models and names the default. */
  get fixed(): boolean {
    return this.o.allowed !== undefined && this.o.defaultModel !== undefined;
  }

  async list(): Promise<ModelInfo[]> {
    const ids = this.fixed ? this.o.allowed! : (await this.usable()).map((m) => m.name);
    const def = await this.defaultId().catch(() => null);
    return ids.map((id) => ({ id, default: id === def }));
  }

  async getDefault(): Promise<ModelInfo> {
    return { id: await this.defaultId(), default: true };
  }

  /** Throws a plain-language AppError when `model` can't be used on this gateway. */
  async check(model: string): Promise<void> {
    if (this.o.allowed && !this.o.allowed.includes(model)) {
      throw new AppError(400, 'model_not_allowed', `model not allowed: ${model}`);
    }
    if (this.fixed) return; // the configured list is the contract; the provider reports the rest

    const found = (await this.find(model)) ?? (await this.find(model, true)); // just pulled? look again
    if (!found) throw fromProviderError(modelNotInstalled(model));
    if (!canChat(found)) {
      throw new AppError(400, 'model_cannot_chat', `The model ${model} can't chat (it only makes embeddings).`, {
        hint: 'Choose a chat model (see: llm models).',
      });
    }
  }

  /** How the default is chosen right now. For the startup log and diagnostics. */
  async describePick(): Promise<PickResult> {
    return pickModel({
      installed: await this.usable(),
      totalMemoryBytes: this.o.totalMemoryBytes,
      contextTokens: this.o.contextTokens,
    });
  }

  private async defaultId(): Promise<string> {
    if (this.o.defaultModel) return this.o.defaultModel;
    const pick = await this.describePick();
    if (pick.kind === 'picked') return pick.model;
    if (pick.kind === 'none_installed') {
      throw new AppError(503, 'no_model_installed', 'No chat model is downloaded yet.', {
        hint: `Run: ollama pull ${pick.suggestion}`,
      });
    }
    throw new AppError(
      503,
      'no_model_fits',
      `The downloaded models need more memory than this machine can spare (${pick.smallest.model} needs about ${gb(pick.smallest.needBytes)} GB; the limit is ${gb(pick.budgetBytes)} GB).`,
      { hint: `Download a smaller one: ollama pull ${pick.suggestion}` },
    );
  }

  /** Installed chat models, limited to ALLOWED_MODELS when that is set. */
  private async usable(): Promise<InstalledModel[]> {
    const allowed = this.o.allowed && new Set(this.o.allowed.map(normalizeName));
    return (await this.installed()).filter((m) => canChat(m) && (!allowed || allowed.has(normalizeName(m.name))));
  }

  private async find(model: string, fresh = false): Promise<InstalledModel | undefined> {
    const want = normalizeName(model);
    return (await this.installed(fresh)).find((m) => normalizeName(m.name) === want);
  }

  private async installed(fresh = false): Promise<InstalledModel[]> {
    const now = this.o.now?.() ?? Date.now();
    if (fresh || !this.cache || now - this.cache.at > (this.o.cacheMs ?? 30_000)) {
      const models = this.o.source!.installed();
      this.cache = { at: now, models };
      models.catch(() => {
        if (this.cache?.models === models) this.cache = undefined; // never keep a failure
      });
    }
    try {
      return await this.cache.models;
    } catch (err) {
      throw err instanceof ProviderError ? fromProviderError(err) : err;
    }
  }
}
