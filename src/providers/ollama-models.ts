// Reads what Ollama has installed and loaded, through its native API
// (/api/tags, /api/show, /api/ps). Only metadata: no prompts, no generation.
import { classifyFetchFailure } from './ollama-errors.js';
import { ProviderError } from './types.js';

export interface ModelArchitecture {
  blockCount: number; // transformer layers
  headCountKv: number; // key/value heads (grouped-query attention)
  keyLength: number; // per-head key size
  valueLength: number; // per-head value size
}

export interface InstalledModel {
  name: string;
  sizeBytes: number;
  /** From Ollama `/api/show`, e.g. ["completion", "tools"]. Missing on older Ollama. */
  capabilities?: string[];
  arch?: ModelArchitecture;
}

export interface LoadedModel {
  name: string;
  sizeBytes: number; // total memory Ollama reserved for it
  vramBytes: number; // the part on the GPU; less than sizeBytes means it spilled to the CPU
  contextLength?: number; // the context Ollama actually allocated
}

interface TagsJson {
  models?: Array<{ name: string; size: number; digest?: string }>;
}
interface ShowJson {
  capabilities?: string[];
  model_info?: Record<string, unknown>;
}
interface PsJson {
  models?: Array<{ name: string; size: number; size_vram: number; context_length?: number }>;
}

const TIMEOUT_MS = 3000;

/** Architecture numbers for the KV-cache estimate; keys are prefixed by architecture name. */
export function parseArchitecture(info: Record<string, unknown> | undefined): ModelArchitecture | undefined {
  if (!info) return undefined;
  const arch = info['general.architecture'];
  if (typeof arch !== 'string') return undefined;
  const num = (k: string) => (typeof info[`${arch}.${k}`] === 'number' ? (info[`${arch}.${k}`] as number) : undefined);
  const blockCount = num('block_count');
  const headCount = num('attention.head_count');
  const headCountKv = num('attention.head_count_kv') ?? headCount;
  const embedding = num('embedding_length');
  const headDim = embedding && headCount ? embedding / headCount : undefined;
  const keyLength = num('attention.key_length') ?? headDim;
  const valueLength = num('attention.value_length') ?? headDim;
  if (!blockCount || !headCountKv || !keyLength || !valueLength) return undefined;
  return { blockCount, headCountKv, keyLength, valueLength };
}

export class OllamaModels {
  /** /api/show answers never change for a given digest, so they are kept for the process lifetime. */
  private readonly shown = new Map<string, Pick<InstalledModel, 'capabilities' | 'arch'>>();

  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Throws ProviderError('ollama_unavailable') when Ollama can't be reached. */
  async installed(): Promise<InstalledModel[]> {
    const tags = await this.get<TagsJson>('/api/tags');
    return Promise.all(
      (tags.models ?? []).map(async (m) => {
        const key = `${m.name}@${m.digest ?? ''}`;
        let meta = this.shown.get(key);
        if (!meta) {
          meta = await this.show(m.name);
          if (meta.capabilities) this.shown.set(key, meta); // don't cache a failed lookup
        }
        return { name: m.name, sizeBytes: m.size, ...meta };
      }),
    );
  }

  async loaded(): Promise<LoadedModel[]> {
    const ps = await this.get<PsJson>('/api/ps');
    return (ps.models ?? []).map((m) => ({
      name: m.name,
      sizeBytes: m.size,
      vramBytes: m.size_vram,
      contextLength: m.context_length,
    }));
  }

  private async show(model: string): Promise<Pick<InstalledModel, 'capabilities' | 'arch'>> {
    try {
      const json = await this.get<ShowJson>('/api/show', { model });
      return { capabilities: json.capabilities, arch: parseArchitecture(json.model_info) };
    } catch {
      return {}; // one odd model shouldn't hide the others
    }
  }

  private async get<T>(path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw classifyFetchFailure(err);
    }
    if (!res.ok) {
      throw new ProviderError('provider_error', `Ollama could not list models (error ${res.status}).`, undefined, `${path} HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }
}
