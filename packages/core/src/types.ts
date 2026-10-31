/** A completed word plus the text around it on the same line. */
export interface CorrectionRequest {
  /** Text before the word (typically the start of the line). */
  before: string;
  /** The word the user just finished typing. */
  word: string;
  /** Text after the word, including the boundary character that completed it. */
  after: string;
}

export interface Correction {
  original: string;
  replacement: string;
  /** 0..1. For dictionary corrections: the winning candidate's share of the total candidate score. */
  confidence: number;
  source: 'typo-table' | 'dictionary';
}

export type Mode = 'conservative' | 'balanced' | 'aggressive';

export interface EngineOptions {
  mode?: Mode;
  /** Words that are always accepted as written and never proposed. */
  userWords?: Iterable<string>;
  /** Word-pair statistics; when given, candidates that fit the preceding word rank higher. */
  bigrams?: Bigrams;
}

export interface Bigrams {
  /** P(word | prev) for a lowercase word pair; 0 when the pair is unseen. */
  prob(prev: string, word: string): number;
}

export interface Lexicon {
  /** True if the lowercase word is recognised as valid English. */
  isKnown(word: string): boolean;
  /** Prior weight for proposing the lowercase word as a correction; 0 if it should never be proposed. */
  prior(word: string): number;
}
