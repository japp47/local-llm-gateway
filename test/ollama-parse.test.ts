import { describe, it, expect } from 'vitest';
import { parseSseLine } from '../src/providers/ollama.js';

describe('parseSseLine', () => {
  it('extracts delta text', () => {
    const line = 'data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}';
    expect(parseSseLine(line)).toEqual([{ type: 'delta', text: 'Hi' }]);
  });

  it('extracts finish reason and usage', () => {
    const fin = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}';
    const usage = 'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":5}}';
    expect(parseSseLine(fin)).toEqual([{ type: 'done', finishReason: 'stop' }]);
    expect(parseSseLine(usage)).toEqual([{ type: 'usage', promptTokens: 11, completionTokens: 5 }]);
  });

  it('ignores [DONE], comments, blanks and malformed json', () => {
    expect(parseSseLine('data: [DONE]')).toEqual([]);
    expect(parseSseLine(': keep-alive')).toEqual([]);
    expect(parseSseLine('')).toEqual([]);
    expect(parseSseLine('data: {not json')).toEqual([]);
  });
});
