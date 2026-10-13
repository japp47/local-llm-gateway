import { describe, expect, it } from 'vitest';
import { mean, percentileCont } from '../src/lib/stats.js';

// Expected values were checked against Postgres percentile_cont.
describe('percentileCont', () => {
  it('interpolates like Postgres percentile_cont', () => {
    expect(percentileCont([100, 200, 300, 400], 0.5)).toBe(250);
    expect(percentileCont([100, 200, 300, 400], 0.95)).toBeCloseTo(385, 10);
    expect(percentileCont([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentileCont([10, 20], 0.25)).toBe(12.5);
  });

  it('handles the edges', () => {
    expect(percentileCont([], 0.5)).toBeNull();
    expect(percentileCont([42], 0.95)).toBe(42);
    expect(percentileCont([1, 9], 0)).toBe(1);
    expect(percentileCont([1, 9], 1)).toBe(9);
  });
});

describe('mean', () => {
  it('averages, and is null when empty', () => {
    expect(mean([1, 2, 3, 6])).toBe(3);
    expect(mean([])).toBeNull();
  });
});
