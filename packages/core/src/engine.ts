import { applyCaseShape, caseShape, isSentenceStart, isStandaloneWord, PROTECTED_WORDS } from './safety.ts';
import { IMPLAUSIBLE_WEIGHT, rankCandidates } from './spelling.ts';
import { TYPO_TABLE } from './typos.ts';
import type { Correction, CorrectionRequest, EngineOptions, Lexicon, Mode } from './types.ts';

interface Thresholds {
  minLength: number;
  maxDistance: 1 | 2;
  /** Minimum share of the total candidate score held by the winner. */
  minConfidence: number;
  /** Minimum absolute score (channel weight x prior) of the winner. */
  minScore: number;
  allowImplausibleEdits: boolean;
}

const THRESHOLDS: Record<Mode, Thresholds> = {
  conservative: { minLength: 3, maxDistance: 1, minConfidence: 0.75, minScore: 200, allowImplausibleEdits: false },
  balanced: { minLength: 3, maxDistance: 2, minConfidence: 0.6, minScore: 50, allowImplausibleEdits: true },
};

const MAX_LENGTH = 30;

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
    if (word.length < t.minLength || word.length > MAX_LENGTH || !/^[A-Za-z]+$/.test(word)) return null;

    const shape = caseShape(word);
    if (shape === 'upper' || shape === 'mixed') return null;

    const lower = word.toLowerCase();
    if (this.#userWords.has(lower) || this.#suppressed.has(lower) || PROTECTED_WORDS.has(lower)) return null;
    if (!isStandaloneWord(before, after)) return null;
    // A capitalised unknown word mid-sentence is most likely a name.
    if (shape === 'capitalized' && !isSentenceStart(before)) return null;

    const tabled = TYPO_TABLE[lower];
    if (tabled) return { original: word, replacement: applyCaseShape(tabled, shape), confidence: 0.99, source: 'typo-table' };

    if (this.#lexicon.isKnown(lower)) return null;

    const correction = this.#rank(lower, 1) ?? (t.maxDistance === 2 && lower.length >= 5 ? this.#rank(lower, 2) : null);
    return correction && { original: word, replacement: applyCaseShape(correction.word, shape), confidence: correction.confidence, source: 'dictionary' };
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
    if (confidence < t.minConfidence || best.score < t.minScore) return null;
    return { word: best.word, confidence };
  }
}
