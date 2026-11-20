import { describe, expect, it } from 'vitest';
import { looksLikeLlmCommand } from '../src/repl.js';

describe('commands typed into the chat', () => {
  it('catches llm commands meant for the terminal', () => {
    for (const line of ['llm profile use local', 'llm doctor', 'llm start', 'llm chat "hi"', 'llm backup --json']) {
      expect(looksLikeLlmCommand(line), line).toBe(true);
    }
  });

  it('lets real questions through, even ones that mention llm', () => {
    for (const line of ['llm stands for large language model?', 'what is an llm', 'llmprofile', 'npm install fails, why?', 'llm startups in India']) {
      expect(looksLikeLlmCommand(line), line).toBe(false);
    }
  });
});
