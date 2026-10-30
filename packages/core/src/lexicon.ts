import type { Lexicon } from './types.ts';

/** Parses the `word<TAB>prior` format produced by scripts/build-lexicon.mjs. */
export function parseLexicon(tsv: string): Lexicon {
  const priors = new Map<string, number>();
  for (const line of tsv.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab > 0) priors.set(line.slice(0, tab), Number(line.slice(tab + 1)));
  }
  return {
    isKnown: (word) => priors.has(word),
    prior: (word) => priors.get(word) ?? 0,
  };
}
