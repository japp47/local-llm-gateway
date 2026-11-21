// Model answers often use a little markdown. This shows the common parts (code blocks,
// inline code, bold, headings, lists) WITHOUT ever producing HTML from the text:
// everything becomes React elements, and React escapes all text. A model can be tricked
// into writing `<script>` or `<img onerror=...>`; here that is just visible text.
// Links are shown as text (label and address), not clickable: no surprise navigation.
import { Fragment, type ReactNode } from 'react';

type Block =
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'paragraph'; lines: string[] };

const FENCE = /^```\s*([\w+-]*)\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;

export function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'paragraph', lines: para });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      // An unclosed fence (answer still streaming) runs to the end of the text.
      for (i++; i < lines.length && !FENCE.test(lines[i]!); i++) body.push(lines[i]!);
      blocks.push({ kind: 'code', lang: fence[1] ?? '', text: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]! });
      continue;
    }
    const item = BULLET.exec(line) ?? NUMBERED.exec(line);
    if (item) {
      flush();
      const ordered = !BULLET.test(line);
      const items = [item[1]!];
      while (i + 1 < lines.length) {
        const next = (ordered ? NUMBERED : BULLET).exec(lines[i + 1]!);
        if (!next) break;
        items.push(next[1]!);
        i++;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    if (line.trim() === '') flush();
    else para.push(line);
  }
  flush();
  return blocks;
}

// Link addresses may contain one level of parentheses, e.g. https://en.wikipedia.org/wiki/Go_(game)
const HREF = String.raw`(?:[^()\s]|\([^()\s]*\))+`;
const INLINE = new RegExp(String.raw`(\`[^\`\n]+\`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(${HREF}\))`, 'g');
const LINK = new RegExp(String.raw`^\[([^\]]+)\]\((${HREF})\)$`);

/** Inline code, bold and links inside one line, as React nodes (never HTML). */
export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const tok = m[0];
    if (m.index! > last) out.push(text.slice(last, m.index));
    if (tok.startsWith('`')) out.push(<code key={n++}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('**')) out.push(<strong key={n++}>{tok.slice(2, -2)}</strong>);
    else {
      const [, label, href] = LINK.exec(tok)!;
      out.push(<span key={n++} className="link-text">{`${label} (${href})`}</span>);
    }
    last = m.index! + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  return (
    <>
      {parseBlocks(text).map((b, i) => {
        switch (b.kind) {
          case 'code':
            return (
              <pre key={i} className="code" data-lang={b.lang || undefined}>
                <code>{b.text}</code>
              </pre>
            );
          case 'heading':
            return <p key={i} className={`heading h${Math.min(b.level, 3)}`}>{renderInline(b.text)}</p>;
          case 'list': {
            const items = b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>);
            return b.ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
          }
          case 'paragraph':
            return (
              <p key={i}>
                {b.lines.map((l, j) => (
                  <Fragment key={j}>
                    {j > 0 && <br />}
                    {renderInline(l)}
                  </Fragment>
                ))}
              </p>
            );
        }
      })}
    </>
  );
}
