import { describe, expect, it } from 'vitest';
import { SseParser } from '../src/sse.js';

describe('SseParser', () => {
  it('parses complete events', () => {
    const p = new SseParser();
    expect(p.push('event: delta\ndata: {"text":"Hi"}\n\nevent: done\ndata: {}\n\n')).toEqual([
      { event: 'delta', data: '{"text":"Hi"}' },
      { event: 'done', data: '{}' },
    ]);
  });

  it('reassembles events split at arbitrary byte boundaries', () => {
    const whole = 'event: delta\ndata: {"text":"héllo"}\n\nevent: done\ndata: {"ok":true}\n\n';
    for (let size = 1; size <= 9; size++) {
      const p = new SseParser();
      const got = [];
      for (let i = 0; i < whole.length; i += size) got.push(...p.push(whole.slice(i, i + size)));
      expect(got.map((e) => e.event), `chunk size ${size}`).toEqual(['delta', 'done']);
      expect(got[0]!.data).toBe('{"text":"héllo"}');
    }
  });

  it('handles CRLF, comments, multi-line data and a default event name', () => {
    const p = new SseParser();
    expect(p.push(': keep-alive\r\n\r\ndata: a\r\ndata: b\r\n\r\n')).toEqual([{ event: 'message', data: 'a\nb' }]);
  });

  it('keeps an incomplete trailing event buffered', () => {
    const p = new SseParser();
    expect(p.push('event: delta\ndata: {"te')).toEqual([]);
    expect(p.push('xt":"x"}\n\n')).toEqual([{ event: 'delta', data: '{"text":"x"}' }]);
  });
});