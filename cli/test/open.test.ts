import { describe, expect, it } from 'vitest';
import { browserCommand } from '../src/commands/open.js';

describe('llm open', () => {
  it('uses each system\'s way to open a URL', () => {
    const url = 'http://localhost:3000/#code=abc';
    expect(browserCommand(url, 'darwin')).toEqual(['open', [url]]);
    expect(browserCommand(url, 'linux')).toEqual(['xdg-open', [url]]);
    expect(browserCommand(url, 'win32')).toEqual(['cmd', ['/c', 'start', '""', url]]);
  });
});
