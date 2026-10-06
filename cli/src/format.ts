import type { Message, StreamMeta } from './api.js';

export function makeColors(on: boolean) {
  const wrap = (open: number, close: number) => (s: string) => (on ? `\x1b[${open}m${s}\x1b[${close}m` : s);
  return {
    dim: wrap(2, 22),
    bold: wrap(1, 22),
    red: wrap(31, 39),
    green: wrap(32, 39),
    yellow: wrap(33, 39),
    cyan: wrap(36, 39),
  };
}
export type Colors = ReturnType<typeof makeColors>;

const useColor = (s: NodeJS.WriteStream) => Boolean(s.isTTY) && !process.env.NO_COLOR;
export const out = makeColors(useColor(process.stdout)); // for stdout
export const errc = makeColors(useColor(process.stderr)); // for stderr

export const shortId = (id: string) => id.slice(0, 8);

export function truncate(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : flat.slice(0, Math.max(0, max - 1)) + '…';
}

export function relativeTime(when: string | Date, now = Date.now()): string {
  const t = typeof when === 'string' ? Date.parse(when) : when.getTime();
  const sec = Math.max(0, Math.round((now - t) / 1000));
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 90) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 36) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 14) return `${day}d ago`;
  return new Date(t).toISOString().slice(0, 10);
}

/** Plain-text aligned table (colorize the returned lines yourself). */
export function renderTable(header: string[], rows: string[][]): string[] {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ').trimEnd();
  return [line(header), ...rows.map(line)];
}

export function tokPerSec(m: Pick<StreamMeta, 'completionTokens' | 'generationMs' | 'ttftMs'>): number | null {
  if (!m.completionTokens) return null;
  const ms = m.generationMs - (m.ttftMs ?? 0);
  return ms > 0 ? m.completionTokens / (ms / 1000) : null;
}

export function formatMetaLine(m: StreamMeta, c: Colors): string {
  const approx = m.usageSource === 'estimated' ? '~' : '';
  const tps = tokPerSec(m);
  const parts = [
    `${m.provider}/${m.model}`,
    `${approx}${m.promptTokens} in / ${approx}${m.completionTokens} out`,
    m.ttftMs === null ? null : `ttft ${m.ttftMs}ms`,
    tps === null ? null : `${tps.toFixed(1)} tok/s`,
    `ctx ${m.contextUsed}/${m.contextBudget}`,
    m.queueWaitMs >= 100 ? `queued ${m.queueWaitMs}ms` : null,
  ].filter((p): p is string => p !== null);
  return c.dim(parts.join('  ·  '));
}

export function formatMessage(m: Message, index: number, c: Colors): string {
  const label = m.role === 'user' ? c.cyan('you') : m.role === 'assistant' ? c.green('assistant') : c.dim(m.role);
  const tag = m.status === 'partial' ? c.yellow(' (partial)') : m.status === 'error' ? c.red(' (error)') : '';
  const body = m.content
    .split('\n')
    .map((l, i) => (i === 0 ? l : '     ' + l))
    .join('\n');
  return `${c.dim(String(index).padStart(3))}  ${label}${tag}  ${body}`;
}