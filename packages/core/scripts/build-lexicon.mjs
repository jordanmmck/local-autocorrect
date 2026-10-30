// Builds data/en-US.tsv from SCOWL word lists (wordlist-english) and
// SUBTLEX-US word frequencies (subtlex-word-frequencies).
//
// Words in lexicon/informal.txt (informal vocabulary and profanity SCOWL
// omits) are added as proposable.
//
// Each line is `word<TAB>prior`. A prior > 0 means the word may be proposed
// as a correction; 0 means the word is recognised as valid but never proposed
// (acronyms, proper nouns, colloquial spellings seen only in subtitles).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

// SCOWL size levels: 10 is the most common vocabulary, 70 the most obscure.
const SIZES = [10, 20, 35, 40, 50, 55, 60, 70];
const VARIANTS = ['english', 'american'];
// Pseudo-counts for SCOWL words that SUBTLEX never saw, so a common word
// absent from subtitles still competes as a candidate.
const TIER_FLOOR = { 10: 50, 20: 20, 35: 5, 40: 3, 50: 1, 55: 0.5, 60: 0.5, 70: 0.5 };
// Prior for supplementary words SUBTLEX never saw (about a SCOWL size-20 word).
const SUPPLEMENT_FLOOR = 20;
// Subtitle-only tokens need this many occurrences to count as known words.
const MIN_SUBTLEX_KNOWN = 20;

const counts = new Map();
for (const { word, count } of require('subtlex-word-frequencies')) {
  const lower = word.toLowerCase();
  counts.set(lower, (counts.get(lower) ?? 0) + count);
}

const priors = new Map();
for (const size of SIZES) {
  for (const variant of VARIANTS) {
    for (const word of require(`wordlist-english/${variant}-words-${size}.json`)) {
      const lower = word.toLowerCase();
      if (priors.has(lower)) continue;
      const proposable = word === lower && /^[a-z]+$/.test(word);
      priors.set(lower, proposable ? Math.max(counts.get(lower) ?? 0, TIER_FLOOR[size]) : 0);
    }
  }
}
const supplement = readFileSync(join(here, '..', 'lexicon', 'informal.txt'), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));
for (const word of supplement) {
  priors.set(word, Math.max(priors.get(word) ?? 0, counts.get(word) ?? 0, SUPPLEMENT_FLOOR));
}
for (const [word, count] of counts) {
  if (!priors.has(word) && count >= MIN_SUBTLEX_KNOWN && /^[a-z]+$/.test(word)) priors.set(word, 0);
}

const lines = [...priors].sort(([a], [b]) => (a < b ? -1 : 1)).map(([w, p]) => `${w}\t${p}`);
const out = join(here, '..', 'data', 'en-US.tsv');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join('\n') + '\n');
console.log(`wrote ${lines.length} words to ${out}`);
