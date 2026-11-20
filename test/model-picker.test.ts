import { describe, expect, it } from 'vitest';
import type { InstalledModel } from '../src/providers/ollama-models.js';
import { estimateNeedBytes, kvCacheBytes, pickModel, suggestModel } from '../src/services/model-picker.js';

const GiB = 2 ** 30;
const GB = 1e9;

// Real shapes from Ollama /api/show (llama3.2:3b measured on this project's M4 / 16 GB).
const llama3b: InstalledModel = {
  name: 'llama3.2:3b',
  sizeBytes: 2_019_393_189,
  capabilities: ['completion', 'tools'],
  arch: { blockCount: 28, headCountKv: 8, keyLength: 128, valueLength: 128 },
};
const m = (name: string, sizeGb: number, extra: Partial<InstalledModel> = {}): InstalledModel => ({
  name,
  sizeBytes: sizeGb * GB,
  capabilities: ['completion'],
  ...extra,
});
const qwen4b = m('qwen3:4b', 2.5);
const qwen8b = m('qwen3:8b', 5.2);
const gemma12b = m('gemma4:12b', 8.0);
const mentor = m('backend-mentor:latest', 2.0);
const bigCustom = m('my-70b:latest', 40);
const embed = m('nomic-embed-text:latest', 0.27, { capabilities: ['embedding'] });

describe('memory estimate', () => {
  it('matches the measured llama3.2:3b within a few percent', () => {
    expect(kvCacheBytes(llama3b, 4096)).toBe(469_762_048); // 0.47 GB at 4k tokens
    const measured = 2_548_417_166; // /api/ps size after loading, context 4096
    expect(Math.abs(estimateNeedBytes(llama3b, 4096) - measured) / measured).toBeLessThan(0.1);
  });

  it('grows with the context: the same model at 128k needs far more', () => {
    expect(kvCacheBytes(llama3b, 131_072)).toBe(32 * kvCacheBytes(llama3b, 4096)); // ~15 GB
  });
});

describe('pickModel', () => {
  const cases: Array<{
    name: string;
    ramGiB: number;
    installed: InstalledModel[];
    expected: { kind: string; model?: string; why?: string; suggestion?: string };
  }> = [
    { name: '16 GB, only llama3.2:3b', ramGiB: 16, installed: [llama3b], expected: { kind: 'picked', model: 'llama3.2:3b', why: 'preferred' } },
    { name: '16 GB prefers qwen3:8b over smaller ones', ramGiB: 16, installed: [llama3b, qwen8b, qwen4b], expected: { kind: 'picked', model: 'qwen3:8b' } },
    { name: '16 GB: gemma4:12b is preferred but does not fit the 8 GB budget', ramGiB: 16, installed: [gemma12b, qwen8b], expected: { kind: 'picked', model: 'qwen3:8b' } },
    { name: '32 GB: gemma4:12b fits', ramGiB: 32, installed: [gemma12b, qwen8b], expected: { kind: 'picked', model: 'gemma4:12b' } },
    { name: '8 GB: qwen3:8b does not fit, qwen3:4b does', ramGiB: 8, installed: [qwen8b, qwen4b, llama3b], expected: { kind: 'picked', model: 'qwen3:4b' } },
    { name: 'nothing from our list: largest that fits', ramGiB: 16, installed: [mentor, m('mistral:7b', 4.1), bigCustom], expected: { kind: 'picked', model: 'mistral:7b', why: 'largest_that_fits' } },
    { name: 'embedding models are never picked', ramGiB: 16, installed: [embed, llama3b], expected: { kind: 'picked', model: 'llama3.2:3b' } },
    { name: 'only an embedding model: nothing to chat with', ramGiB: 16, installed: [embed], expected: { kind: 'none_installed', suggestion: 'qwen3:8b' } },
    { name: 'nothing installed, 8 GB', ramGiB: 8, installed: [], expected: { kind: 'none_installed', suggestion: 'llama3.2:3b' } },
    { name: 'nothing installed, 32 GB', ramGiB: 32, installed: [], expected: { kind: 'none_installed', suggestion: 'gemma4:12b' } },
    { name: 'only a huge model', ramGiB: 16, installed: [bigCustom], expected: { kind: 'none_fit', suggestion: 'qwen3:8b' } },
    { name: 'tag-less name on our list ("llama3.2:3b" vs custom tag) is not confused', ramGiB: 16, installed: [m('llama3.2:latest', 2.0)], expected: { kind: 'picked', why: 'largest_that_fits' } },
    { name: 'older Ollama without capabilities: guessed by name', ramGiB: 16, installed: [m('nomic-embed-text:latest', 0.27, { capabilities: undefined }), m('phi3:mini', 2.2, { capabilities: undefined })], expected: { kind: 'picked', model: 'phi3:mini' } },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const result = pickModel({ installed: c.installed, totalMemoryBytes: c.ramGiB * GiB, contextTokens: 4096 });
      expect(result).toMatchObject(c.expected);
    });
  }

  it('uses half of total RAM as the budget', () => {
    const r = pickModel({ installed: [llama3b], totalMemoryBytes: 16 * GiB, contextTokens: 4096 });
    expect(r.budgetBytes).toBe(8 * GiB);
  });

  it('suggests by RAM tier', () => {
    expect([8, 16, 32, 64].map((g) => suggestModel(g * GiB))).toEqual(['llama3.2:3b', 'qwen3:8b', 'gemma4:12b', 'gemma4:12b']);
  });
});
