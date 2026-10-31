import { readFileSync } from 'node:fs';
import { AutocorrectEngine, parseBigrams, parseLexicon, type EngineOptions } from '../src/index.ts';

export const lexicon = parseLexicon(readFileSync(new URL('../data/en-US.tsv', import.meta.url), 'utf8'));
export const bigrams = parseBigrams(readFileSync(new URL('../data/bigrams-en.tsv', import.meta.url), 'utf8'));

export function engine(options?: EngineOptions) {
  return new AutocorrectEngine(lexicon, options);
}

/** Corrects the last word of `line`, as if `boundary` had just been typed after it. */
export function correctLast(e: AutocorrectEngine, line: string, boundary = ' '): string | undefined {
  const match = /^(.*?)([A-Za-z']+)$/s.exec(line);
  if (!match) return undefined;
  return e.check({ before: match[1], word: match[2], after: boundary })?.replacement;
}
