import { applyCaseShape, caseShape, isSentenceStart, isStandaloneWord, PROTECTED_WORDS } from './safety.ts';
import { IMPLAUSIBLE_WEIGHT, rankCandidates } from './spelling.ts';
import { TYPO_TABLE } from './typos.ts';
import type { Correction, CorrectionRequest, EngineOptions, Lexicon, Mode } from './types.ts';

interface Thresholds {
  minLength: number;
  maxDistance: 1 | 2;
  /** Words shorter than this only get distance-1 candidates even when maxDistance is 2. */
  minLengthDistance2: number;
  /** Minimum share of the total candidate score held by the winner. */
  minConfidence: number;
  /** Minimum absolute score (channel weight x prior) of the winner. */
  minScore: number;
  /** Winners at or above this confidence skip the minScore floor, so rare words with one clear candidate are still fixed. */
  soloConfidence: number;
  allowImplausibleEdits: boolean;
}

const THRESHOLDS: Record<Mode, Thresholds> = {
  conservative: { minLength: 3, maxDistance: 1, minLengthDistance2: 5, minConfidence: 0.75, minScore: 200, soloConfidence: Infinity, allowImplausibleEdits: false },
  balanced: { minLength: 3, maxDistance: 2, minLengthDistance2: 5, minConfidence: 0.6, minScore: 50, soloConfidence: Infinity, allowImplausibleEdits: true },
  aggressive: { minLength: 3, maxDistance: 2, minLengthDistance2: 4, minConfidence: 0.6, minScore: 50, soloConfidence: 0.9, allowImplausibleEdits: true },
};

const MAX_LENGTH = 30;
/**
 * The solo-confidence override only applies to likely slips (transpositions,
 * omissions, doublings), so a lone far-fetched candidate cannot win merely by
 * having no competitors ("Ethereum" must not become "Ethereal").
 */
const SOLO_MIN_WEIGHT = 0.5;
/** The pronoun typed in lowercase, alone or with a contraction. */
const I_PRONOUN = /^i('(m|ve|ll|d))?$/;

export class AutocorrectEngine {
  #lexicon: Lexicon;
  #thresholds: Thresholds;
  #userWords = new Set<string>();
  #suppressed = new Set<string>();

  constructor(lexicon: Lexicon, options: EngineOptions = {}) {
    this.#lexicon = lexicon;
    this.#thresholds = THRESHOLDS[options.mode ?? 'conservative'];
    this.setUserWords(options.userWords ?? []);
  }

  setMode(mode: Mode): void {
    this.#thresholds = THRESHOLDS[mode];
  }

  setUserWords(words: Iterable<string>): void {
    this.#userWords = new Set([...words].map((w) => w.toLowerCase()));
  }

  /** Never correct this word again (for the lifetime of the engine). Used when the user reverts a correction. */
  suppress(word: string): void {
    this.#suppressed.add(word.toLowerCase());
  }

  check({ before, word, after }: CorrectionRequest): Correction | null {
    const t = this.#thresholds;
    if (I_PRONOUN.test(word)) return this.#capitaliseI(before, word, after);
    const lower = word.toLowerCase();
    const tabled = TYPO_TABLE[lower];
    // Table entries may be short ("im"); everything else needs the minimum length.
    if ((word.length < t.minLength && !tabled) || word.length > MAX_LENGTH || !/^[A-Za-z]+$/.test(word)) return null;

    const shape = caseShape(word);
    if (shape === 'upper' || shape === 'mixed') return null;

    if (this.#userWords.has(lower) || this.#suppressed.has(lower) || PROTECTED_WORDS.has(lower)) return null;
    if (!isStandaloneWord(before, after)) return null;
    // A capitalised unknown word mid-sentence is most likely a name.
    if (shape === 'capitalized' && !isSentenceStart(before)) return null;

    if (tabled) return { original: word, replacement: applyCaseShape(tabled, shape), confidence: 0.99, source: 'typo-table' };

    if (this.#lexicon.isKnown(lower)) return null;

    const correction = this.#rank(lower, 1) ?? (t.maxDistance === 2 && lower.length >= t.minLengthDistance2 ? this.#rank(lower, 2) : null);
    return correction && { original: word, replacement: applyCaseShape(correction.word, shape), confidence: correction.confidence, source: 'dictionary' };
  }

  /** "i" -> "I", "i'm" -> "I'm", unless it looks like a list marker such as "(i)". */
  #capitaliseI(before: string, word: string, after: string): Correction | null {
    if (this.#suppressed.has(word) || this.#userWords.has(word) || !isStandaloneWord(before, after)) return null;
    if (word === 'i' && before.endsWith('(') && after.startsWith(')')) return null;
    return { original: word, replacement: 'I' + word.slice(1), confidence: 0.99, source: 'typo-table' };
  }

  /** The best candidate within `maxDistance` slips, if it clears the confidence thresholds. */
  #rank(lower: string, maxDistance: 1 | 2): { word: string; confidence: number } | null {
    const t = this.#thresholds;
    const candidates = rankCandidates(lower, this.#lexicon, maxDistance);
    const best = candidates[0];
    // Shrinking a typo to a one- or two-letter word ("rew" -> "re") is rarely what was meant.
    if (!best || best.word.length < 3) return null;
    if (!t.allowImplausibleEdits && best.weight <= IMPLAUSIBLE_WEIGHT) return null;

    const total = candidates.reduce((sum, c) => sum + c.score, 0);
    const confidence = best.score / total;
    if (confidence < t.minConfidence) return null;
    const soloWinner = confidence >= t.soloConfidence && best.weight >= SOLO_MIN_WEIGHT;
    if (best.score < t.minScore && !soloWinner) return null;
    return { word: best.word, confidence };
  }
}
