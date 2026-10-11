import { describe, expect, it } from 'vitest';
import type { StreamMeta } from '../src/api.js';
import { formatMetaLine, makeColors, relativeTime, renderTable, tokPerSec, truncate } from '../src/format.js';

const plain = makeColors(false);
const meta = (o: Partial<StreamMeta> = {}): StreamMeta => ({
  provider: 'ollama', model: 'llama3.2:3b', promptTokens: 40, completionTokens: 100, usageSource: 'provider',
  queueWaitMs: 0, ttftMs: 500, generationMs: 4500, totalMs: 4500, contextUsed: 300, contextBudget: 3296, droppedMessages: 0, ...o,
});

describe('relativeTime', () => {
  const now = Date.parse('2026-10-06T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it('formats recent times', () => {
    expect(relativeTime(ago(10_000), now)).toBe('just now');
    expect(relativeTime(ago(5 * 60_000), now)).toBe('5m ago');
    expect(relativeTime(ago(3 * 3_600_000), now)).toBe('3h ago');
    expect(relativeTime(ago(3 * 86_400_000), now)).toBe('3d ago');
  });
  it('falls back to a date for old items', () => {
    expect(relativeTime(ago(30 * 86_400_000), now)).toBe('2026-09-06');
  });
});

describe('truncate / renderTable', () => {
  it('collapses whitespace and truncates with an ellipsis', () => {
    expect(truncate('a\n b   c', 20)).toBe('a b c');
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
  });
  it('pads columns to the widest cell', () => {
    expect(renderTable(['ID', 'NAME'], [['1', 'alpha'], ['22', 'b']])).toEqual(['ID  NAME', '1   alpha', '22  b']);
  });
});

describe('speed and metadata line', () => {
  it('computes tok/s from generation time after the first token', () => {
    expect(tokPerSec(meta())).toBeCloseTo(25, 5); // 100 tokens / 4.0s
  });
  it('returns null when it cannot be computed', () => {
    expect(tokPerSec(meta({ completionTokens: 0 }))).toBeNull();
    expect(tokPerSec(meta({ generationMs: 500, ttftMs: 500 }))).toBeNull();
  });
  it('marks estimated token counts and hides trivial queue time', () => {
    const line = formatMetaLine(meta({ usageSource: 'estimated' }), plain);
    expect(line).toContain('~40 in / ~100 out');
    expect(line).not.toContain('queued');
    expect(formatMetaLine(meta({ queueWaitMs: 800 }), plain)).toContain('queued 800ms');
  });
});