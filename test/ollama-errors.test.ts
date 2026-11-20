import { describe, expect, it } from 'vitest';
import { OllamaProvider } from '../src/providers/ollama.js';
import { classifyFetchFailure, classifyHttpFailure, classifyStreamFailure } from '../src/providers/ollama-errors.js';
import { OllamaModels, parseArchitecture } from '../src/providers/ollama-models.js';
import { ProviderError } from '../src/providers/types.js';
import { fitWarnings } from '../src/services/model-fit.js';

/** What Node's fetch throws when nothing listens on the port. */
const refused = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });

describe('classifying Ollama failures', () => {
  it('connection refused or a timeout means Ollama is not running', () => {
    expect(classifyFetchFailure(refused())).toMatchObject({
      code: 'ollama_unavailable',
      message: "Ollama isn't running.",
      hint: 'Open the Ollama app (or run: ollama serve), then try again.',
    });
    expect(classifyFetchFailure(Object.assign(new Error('t'), { name: 'TimeoutError' })).code).toBe('ollama_unavailable');
  });

  it('a 404 means the model was never downloaded', () => {
    const body = `{"error":{"message":"model 'qwen3:4b' not found","type":"not_found_error","param":null,"code":null}}`;
    expect(classifyHttpFailure(404, body, 'qwen3:4b')).toMatchObject({
      code: 'model_not_installed',
      message: "The model qwen3:4b isn't downloaded yet.",
      hint: 'Run: ollama pull qwen3:4b',
    });
  });

  it("Ollama's memory refusal means the model is too large right now", () => {
    const body = '{"error":{"message":"model requires more system memory (17.5 GiB) than is available (9.8 GiB)"}}';
    expect(classifyHttpFailure(500, body, 'gemma4:12b').code).toBe('model_too_large');
  });

  it('anything else is a generic provider error whose details stay out of the message', () => {
    const err = classifyHttpFailure(500, '{"error":"llama runner process has terminated: /private/var/x"}', 'm');
    expect(err.code).toBe('provider_error');
    expect(err.message).not.toContain('/private');
    expect(err.detail).toContain('/private'); // for the log
  });

  it('a broken stream means the model stopped; known errors pass through', () => {
    expect(classifyStreamFailure(new Error('terminated')).code).toBe('model_stopped');
    const known = new ProviderError('model_too_large', 'x');
    expect(classifyStreamFailure(known)).toBe(known);
  });
});

describe('OllamaProvider.chat opens before streaming', () => {
  it('rejects with a classified error, before any text, when Ollama is down', async () => {
    const provider = new OllamaProvider('http://ollama', async () => {
      throw refused();
    });
    await expect(provider.chat({ model: 'm', messages: [] })).rejects.toMatchObject({ code: 'ollama_unavailable' });
  });

  it('passes a caller cancellation through unchanged', async () => {
    const ac = new AbortController();
    ac.abort();
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const provider = new OllamaProvider('http://ollama', async () => {
      throw abortErr;
    });
    await expect(provider.chat({ model: 'm', messages: [], signal: ac.signal })).rejects.toBe(abortErr);
  });
});

describe('reading model metadata', () => {
  it('reads the KV-cache shape from /api/show model_info (llama3.2:3b, real values)', () => {
    expect(
      parseArchitecture({
        'general.architecture': 'llama',
        'llama.attention.head_count': 24,
        'llama.attention.head_count_kv': 8,
        'llama.attention.key_length': 128,
        'llama.attention.value_length': 128,
        'llama.block_count': 28,
        'llama.embedding_length': 3072,
      }),
    ).toEqual({ blockCount: 28, headCountKv: 8, keyLength: 128, valueLength: 128 });
  });

  it('derives the head size when key/value lengths are missing, and gives up on unknown shapes', () => {
    const info = { 'general.architecture': 'x', 'x.block_count': 2, 'x.attention.head_count': 4, 'x.embedding_length': 256 };
    expect(parseArchitecture(info)).toEqual({ blockCount: 2, headCountKv: 4, keyLength: 64, valueLength: 64 });
    expect(parseArchitecture({ 'general.architecture': 'x' })).toBeUndefined();
    expect(parseArchitecture(undefined)).toBeUndefined();
  });

  it('lists installed models with capabilities, and survives one model failing /api/show', async () => {
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/tags')) {
        return Response.json({ models: [{ name: 'a:1', size: 10, digest: 'd1' }, { name: 'b:1', size: 20, digest: 'd2' }] });
      }
      const { model } = JSON.parse(String(init?.body));
      if (model === 'b:1') return new Response('boom', { status: 500 });
      return Response.json({ capabilities: ['completion'], model_info: {} });
    }) as typeof fetch;
    expect(await new OllamaModels('http://o', fetchImpl).installed()).toEqual([
      { name: 'a:1', sizeBytes: 10, capabilities: ['completion'], arch: undefined },
      { name: 'b:1', sizeBytes: 20 },
    ]);
  });

  it('says Ollama is not running when listing fails to connect', async () => {
    const models = new OllamaModels('http://o', (async () => {
      throw refused();
    }) as typeof fetch);
    await expect(models.installed()).rejects.toMatchObject({ code: 'ollama_unavailable' });
  });
});

describe('fit warnings from /api/ps', () => {
  const loaded = { name: 'llama3.2:3b', sizeBytes: 2_548_417_166, vramBytes: 2_548_417_166, contextLength: 4096 };

  it('says nothing when the model is fully on the GPU with the planned context', () => {
    expect(fitWarnings(loaded, 4096)).toEqual([]);
    expect(fitWarnings(undefined, 4096)).toEqual([]);
  });

  it('warns when part of the model spilled to the CPU', () => {
    const [msg] = fitWarnings({ ...loaded, vramBytes: loaded.sizeBytes * 0.6 }, 4096);
    expect(msg).toContain('60% on the GPU');
  });

  it('warns when Ollama chose a different context than the gateway plans for', () => {
    const [msg] = fitWarnings({ ...loaded, contextLength: 32768 }, 4096);
    expect(msg).toContain('32768-token context');
  });
});
