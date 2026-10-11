export interface SseEvent {
  event: string;
  data: string;
}

/** Incremental Server-Sent Events parser. Feed it text chunks of any size. */
export class SseParser {
  private buf = '';

  push(chunk: string): SseEvent[] {
    this.buf += chunk;
    const events: SseEvent[] = [];
    const boundary = /\r?\n\r?\n/;
    let m: RegExpExecArray | null;
    while ((m = boundary.exec(this.buf))) {
      const block = this.buf.slice(0, m.index);
      this.buf = this.buf.slice(m.index + m[0].length);
      const ev = parseBlock(block);
      if (ev) events.push(ev);
    }
    return events;
  }
}

function parseBlock(block: string): SseEvent | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue; // blank or comment (keep-alive)
    const i = line.indexOf(':');
    const field = i === -1 ? line : line.slice(0, i);
    let value = i === -1 ? '' : line.slice(i + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  return data.length > 0 ? { event, data: data.join('\n') } : null;
}