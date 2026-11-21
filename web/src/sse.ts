// Server-Sent Events arrive in arbitrary pieces over the network. This turns those pieces
// back into whole events: "event: <name>\ndata: <json>\n\n".
export interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

export class SseParser {
  private buffer = '';

  /** Feed the next piece of text; returns the events it completed (possibly none). */
  push(text: string): SseEvent[] {
    this.buffer += text.replace(/\r\n/g, '\n');
    const events: SseEvent[] = [];
    let end: number;
    while ((end = this.buffer.indexOf('\n\n')) >= 0) {
      const block = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const parsed = parseBlock(block);
      if (parsed) events.push(parsed);
    }
    return events;
  }
}

function parseBlock(block: string): SseEvent | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return null;
  try {
    return { event, data: JSON.parse(data.join('\n')) as Record<string, unknown> };
  } catch {
    return null; // a malformed frame is skipped, not fatal
  }
}
