import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown, parseBlocks } from './markdown';

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe('markdown: model output never becomes HTML', () => {
  it('escapes tags, scripts and event handlers', () => {
    const out = html('Hi <script>alert(1)</script> <img src=x onerror=alert(1)> <b>bold?</b>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<b>');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes HTML inside code, bold and list items too', () => {
    for (const text of ['`<script>x</script>`', '**<img onerror=x>**', '- <iframe src=x>', '```\n<script>x</script>\n```']) {
      const out = html(text);
      expect(out, text).not.toMatch(/<(script|img|iframe)/);
    }
  });

  it('shows links as text, never as clickable links (no javascript: URLs)', () => {
    const out = html('[click me](javascript:alert(1)) and [docs](https://example.com)');
    expect(out).not.toContain('<a');
    expect(out).toContain('click me (javascript:alert(1))');
  });
});

describe('markdown: the common formatting', () => {
  it('code blocks keep their text exactly, with the language', () => {
    expect(html('```ts\nconst a = 1;\n  b();\n```')).toBe('<pre class="code" data-lang="ts"><code>const a = 1;\n  b();</code></pre>');
  });

  it('an unclosed code block (still streaming) runs to the end', () => {
    expect(parseBlocks('text\n```py\nprint(1)')).toEqual([
      { kind: 'paragraph', lines: ['text'] },
      { kind: 'code', lang: 'py', text: 'print(1)' },
    ]);
  });

  it('bold, inline code, headings, lists and line breaks', () => {
    expect(html('**Note:** use `npm start`')).toBe('<p><strong>Note:</strong> use <code>npm start</code></p>');
    expect(html('# Title')).toBe('<p class="heading h1">Title</p>');
    expect(html('- one\n- two')).toBe('<ul><li>one</li><li>two</li></ul>');
    expect(html('1. first\n2. second')).toBe('<ol><li>first</li><li>second</li></ol>');
    expect(html('line one\nline two\n\nnew paragraph')).toBe('<p>line one<br/>line two</p><p>new paragraph</p>');
  });
});
