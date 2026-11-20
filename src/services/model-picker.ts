// Picks a default chat model that fits this machine. Pure: no I/O, so the rules are tested
// with a table of cases (test/model-picker.test.ts).
//
// Memory needed ≈ model file + context cache (KV cache) + a little overhead. Checked
// against Ollama on an M4 / 16 GB: llama3.2:3b estimated 2.49 GB + overhead, measured 2.55 GB.
// The budget is half of total RAM: Apple Silicon lets the GPU use roughly 2/3–3/4 of RAM, and
// the rest of the machine (macOS, browser, IDE) needs room too. Total RAM, not "free" RAM:
// macOS keeps "free" low on purpose (caches, compression), so it says little.

import type { InstalledModel } from '../providers/ollama-models.js';

export type { InstalledModel };

export type PickResult =
  | { kind: 'picked'; model: string; needBytes: number; budgetBytes: number; why: 'preferred' | 'largest_that_fits' }
  | { kind: 'none_installed'; budgetBytes: number; suggestion: string }
  | { kind: 'none_fit'; budgetBytes: number; smallest: { model: string; needBytes: number }; suggestion: string };

/**
 * Our order of preference, best first. A short curated list keeps the choice predictable:
 * the same machine with the same models always gets the same default.
 */
export const PREFERRED_MODELS = ['gemma4:12b', 'qwen3:8b', 'qwen3:4b', 'llama3.2:3b', 'llama3.2:1b'];

export const MEMORY_BUDGET_SHARE = 0.5;
const OVERHEAD_BYTES = 256 * 1024 ** 2; // compute buffers; measured ~60 MB, kept generous
const BYTES_PER_KV_VALUE = 2; // Ollama's default KV cache type is f16
const GiB = 1024 ** 3;

/** "llama3.2" and "llama3.2:latest" are the same model to Ollama. */
export const normalizeName = (name: string) => (name.includes(':') ? name : `${name}:latest`);

/** Models that can chat. Embedding-only models (e.g. nomic-embed-text) cannot. */
export function canChat(m: InstalledModel): boolean {
  if (m.capabilities) return m.capabilities.includes('completion');
  return !/embed/i.test(m.name); // older Ollama without capabilities: best guess by name
}

export function kvCacheBytes(m: InstalledModel, contextTokens: number): number {
  if (!m.arch) return Math.round(m.sizeBytes * 0.25 * (contextTokens / 4096)); // unknown shape: assume ~1/4 at 4k
  const { blockCount, headCountKv, keyLength, valueLength } = m.arch;
  return blockCount * contextTokens * headCountKv * (keyLength + valueLength) * BYTES_PER_KV_VALUE;
}

export const estimateNeedBytes = (m: InstalledModel, contextTokens: number) =>
  m.sizeBytes + kvCacheBytes(m, contextTokens) + OVERHEAD_BYTES;

export const memoryBudgetBytes = (totalMemoryBytes: number) => Math.floor(totalMemoryBytes * MEMORY_BUDGET_SHARE);

/** What to download when nothing suitable is installed. */
export function suggestModel(totalMemoryBytes: number): string {
  if (totalMemoryBytes < 12 * GiB) return 'llama3.2:3b'; // 8 GB machines
  if (totalMemoryBytes < 24 * GiB) return 'qwen3:8b'; // 16 GB
  return 'gemma4:12b'; // 32 GB and up
}

export function pickModel(input: {
  installed: InstalledModel[];
  totalMemoryBytes: number;
  contextTokens: number;
  preferred?: string[];
}): PickResult {
  const { totalMemoryBytes, contextTokens, preferred = PREFERRED_MODELS } = input;
  const budgetBytes = memoryBudgetBytes(totalMemoryBytes);
  const suggestion = suggestModel(totalMemoryBytes);

  const chat = input.installed
    .filter(canChat)
    .map((m) => ({ model: m.name, needBytes: estimateNeedBytes(m, contextTokens) }));
  if (chat.length === 0) return { kind: 'none_installed', budgetBytes, suggestion };

  const fits = chat.filter((c) => c.needBytes <= budgetBytes);
  if (fits.length === 0) {
    const smallest = chat.reduce((a, b) => (b.needBytes < a.needBytes ? b : a));
    return { kind: 'none_fit', budgetBytes, smallest, suggestion };
  }

  for (const want of preferred.map(normalizeName)) {
    const hit = fits.find((c) => normalizeName(c.model) === want);
    if (hit) return { kind: 'picked', ...hit, budgetBytes, why: 'preferred' };
  }
  // Nothing from our list: the largest model that fits usually answers best.
  const largest = fits.reduce((a, b) => (b.needBytes > a.needBytes ? b : a));
  return { kind: 'picked', ...largest, budgetBytes, why: 'largest_that_fits' };
}

/** In the units Apple uses for RAM ("16 GB" = 16 GiB), so a 16 GB Mac shows an 8.0 GB budget. */
export const gb = (bytes: number) => (bytes / GiB).toFixed(1);
