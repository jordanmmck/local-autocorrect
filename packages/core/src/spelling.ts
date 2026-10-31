import type { Bigrams, Lexicon } from './types.ts';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
const VOWELS = 'aeiou';

const QWERTY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
// Horizontal offset of each row relative to the top row, in key widths.
const ROW_OFFSETS = [0, 0.25, 0.75];

const KEY_POSITIONS = new Map<string, [number, number]>();
QWERTY_ROWS.forEach((row, y) => [...row].forEach((ch, x) => KEY_POSITIONS.set(ch, [x + ROW_OFFSETS[y], y])));

export function areAdjacentKeys(a: string, b: string): boolean {
  const pa = KEY_POSITIONS.get(a);
  const pb = KEY_POSITIONS.get(b);
  if (!pa || !pb || a === b) return false;
  return Math.abs(pa[1] - pb[1]) <= 1 && Math.abs(pa[0] - pb[0]) <= 1;
}

/**
 * Relative likelihood of each kind of slip when typing fast. These are
 * hand-tuned starting points; benchmarks/ is where they should be calibrated.
 */
export const EDIT_WEIGHTS = {
  transposition: 1,
  doubledOmission: 0.8, // "leter" for "letter"
  omission: 0.5, // "thnk" for "think"
  doubledInsertion: 0.8, // "thhe" for "the"
  adjacentInsertion: 0.6, // "thre" for "the" (r is next to e)
  insertion: 0.2,
  adjacentSubstitution: 0.6, // "thw" for "the"
  vowelSubstitution: 0.3, // "sentance" for "sentence"
  substitution: 0.05,
};

/** Weights at or below this are kept as competitors but never chosen in conservative mode. */
export const IMPLAUSIBLE_WEIGHT = EDIT_WEIGHTS.substitution;

/**
 * Every string one typing slip away from `typed`, mapped to the weight of the
 * most likely slip that produces it.
 */
export function edits1(typed: string): Map<string, number> {
  const out = new Map<string, number>();
  const add = (candidate: string, weight: number) => {
    if (candidate && candidate !== typed && (out.get(candidate) ?? 0) < weight) out.set(candidate, weight);
  };

  for (let i = 0; i <= typed.length; i++) {
    const head = typed.slice(0, i);
    const tail = typed.slice(i);
    const prev = typed[i - 1];
    const cur = typed[i];
    const next = typed[i + 1];

    if (cur !== undefined) {
      // The user typed an extra character at i.
      const insertionWeight =
        cur === prev || cur === next
          ? EDIT_WEIGHTS.doubledInsertion
          : (prev && areAdjacentKeys(cur, prev)) || (next && areAdjacentKeys(cur, next))
            ? EDIT_WEIGHTS.adjacentInsertion
            : EDIT_WEIGHTS.insertion;
      add(head + tail.slice(1), insertionWeight);

      // The user swapped characters i and i+1.
      if (next !== undefined && next !== cur) add(head + next + cur + tail.slice(2), EDIT_WEIGHTS.transposition);
    }

    for (const ch of ALPHABET) {
      // The user left out `ch` at i.
      add(head + ch + tail, ch === prev || ch === cur ? EDIT_WEIGHTS.doubledOmission : EDIT_WEIGHTS.omission);
      // The user typed character i instead of `ch`.
      if (cur !== undefined && ch !== cur) {
        const weight = areAdjacentKeys(ch, cur)
          ? EDIT_WEIGHTS.adjacentSubstitution
          : VOWELS.includes(ch) && VOWELS.includes(cur)
            ? EDIT_WEIGHTS.vowelSubstitution
            : EDIT_WEIGHTS.substitution;
        add(head + ch + tail.slice(1), weight);
      }
    }
  }
  return out;
}

/** Strings two slips away; weights multiply. Used only in balanced mode for longer words. */
export function edits2(typed: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const [first, w1] of edits1(typed)) {
    for (const [second, w2] of edits1(first)) {
      if (second !== typed && (out.get(second) ?? 0) < w1 * w2) out.set(second, w1 * w2);
    }
  }
  return out;
}

export interface Candidate {
  word: string;
  /** Channel weight of the slip that turns `word` into the typed text. */
  weight: number;
  /** weight * prior, where context support raises the prior. */
  score: number;
}

/** The word preceding the typo, when bigram statistics are available for ranking. */
export interface Context {
  prev: string;
  bigrams: Bigrams;
}

/**
 * Pseudo-occurrences granted to a candidate certain to follow the previous
 * word (scaled down by P(candidate | prev)). Context can only add evidence:
 * an unseen pair leaves the unigram prior untouched, so sparse bigram data
 * never penalises a good candidate. Calibrated in benchmarks/.
 */
const CONTEXT_PRIOR = 20_000_000;

/** Proposable dictionary words near `typed` (lowercase), best first. */
export function rankCandidates(typed: string, lexicon: Lexicon, maxDistance: 1 | 2, context?: Context): Candidate[] {
  const edits = edits1(typed);
  if (maxDistance === 2) {
    for (const [word, weight] of edits2(typed)) if (!edits.has(word)) edits.set(word, weight);
  }
  const candidates: Candidate[] = [];
  for (const [word, weight] of edits) {
    let prior = lexicon.prior(word);
    if (prior <= 0) continue;
    // Context only vouches for plausible slips: a far-fetched candidate must
    // not win on fitting the previous word alone ("sqlite" is not "site").
    if (context && weight > IMPLAUSIBLE_WEIGHT) prior += CONTEXT_PRIOR * context.bigrams.prob(context.prev, word);
    candidates.push({ word, weight, score: weight * prior });
  }
  return candidates.sort((a, b) => b.score - a.score);
}
