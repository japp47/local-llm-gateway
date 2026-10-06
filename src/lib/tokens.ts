export interface TokenCounter {
  count(text: string): number;
}

/**
 * Rough estimate behind an interface. Swap in a real tokenizer per model later.
 * Deliberately pessimistic (3 chars/token) so we under-fill the context window.
 */
export class HeuristicTokenCounter implements TokenCounter {
  constructor(private readonly charsPerToken = 3) {}
  count(text: string): number {
    return Math.ceil(text.length / this.charsPerToken);
  }
}