import { describe, expect, it } from 'vitest';
import { SseParser } from './sse';

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

describe('SseParser', () => {
  it('returns whole events, however the network splits them', () => {
    const stream = frame('start', { model: 'm' }) + frame('delta', { text: 'Hel' }) + frame('delta', { text: 'lo' }) + frame('done', { status: 'complete' });
    for (const size of [1, 3, 7, stream.length]) {
      const p = new SseParser();
      const events = [];
      for (let i = 0; i < stream.length; i += size) events.push(...p.push(stream.slice(i, i + size)));
      expect(events.map((e) => e.event), `chunks of ${size}`).toEqual(['start', 'delta', 'delta', 'done']);
      expect(events.filter((e) => e.event === 'delta').map((e) => e.data.text).join('')).toBe('Hello');
    }
  });

  it('accepts CRLF line endings and skips malformed frames', () => {
    const p = new SseParser();
    expect(p.push('event: delta\r\ndata: {"text":"a"}\r\n\r\nevent: x\ndata: {broken\n\n').map((e) => e.data)).toEqual([{ text: 'a' }]);
  });

  it('keeps an incomplete event until the rest arrives', () => {
    const p = new SseParser();
    expect(p.push('event: delta\ndata: {"text":')).toEqual([]);
    expect(p.push('"b"}\n\n')).toEqual([{ event: 'delta', data: { text: 'b' } }]);
  });
});
