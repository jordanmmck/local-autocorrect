// Offline evaluation of the core engine. Usage: npm run bench
//
// Reports, per mode:
//   - recall and precision on hand-written typos (benchmarks/data/typos.tsv)
//   - recall and precision on synthetic single-slip typos of common words
//   - false corrections per 1,000 words of correctly written text (benchmarks/data/clean.txt)
//   - median and p95 time per engine call
//
// Synthetic typos are generated with the same slip types the engine models,
// so they flatter recall; treat them as a regression check, not a quality claim.
import { readFileSync } from 'node:fs';
import { AutocorrectEngine, parseBigrams, parseLexicon, type Mode } from '../packages/core/src/index.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const lexiconTsv = read('../packages/core/data/en-US.tsv');
const lexicon = parseLexicon(lexiconTsv);
const bigrams = parseBigrams(read('../packages/core/data/bigrams-en.tsv'));
const rows = (text: string) => text.split('\n').filter((l) => l.trim() && !l.startsWith('#'));

const handTypos = rows(read('data/typos.tsv')).map((l) => {
  const [typo, expected, category] = l.split('\t');
  return { typo, expected, category };
});
const cleanLines = rows(read('data/clean.txt'));
/** Typos whose fix needs the preceding word; scored only for engines with bigram context. */
const contextTypos = rows(read('data/context.tsv')).map((l) => {
  const [before, typo, expected] = l.split('\t');
  return { before, typo, expected };
});

/** Deterministic PRNG (mulberry32) so the synthetic set is reproducible. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NEIGHBOURS: Record<string, string> = {
  q: 'wa', w: 'qeas', e: 'wrsd', r: 'etdf', t: 'ryfg', y: 'tugh', u: 'yihj', i: 'uojk', o: 'ipkl', p: 'ol',
  a: 'qwsz', s: 'awedxz', d: 'serfcx', f: 'drtgvc', g: 'ftyhbv', h: 'gyujnb', j: 'huikmn', k: 'jiolm', l: 'kop',
  z: 'asx', x: 'zsdc', c: 'xdfv', v: 'cfgb', b: 'vghn', n: 'bhjm', m: 'njk',
};

function syntheticTypos(count: number, minPrior = 500, maxPrior = Infinity) {
  const random = rng(42);
  const pick = <T>(xs: T[]) => xs[Math.floor(random() * xs.length)];
  const words = lexiconTsv
    .split('\n')
    .map((l) => l.split('\t'))
    .filter(([w, p]) => w && w.length >= 4 && Number(p) >= minPrior && Number(p) < maxPrior)
    .map(([w]) => w);
  const out: { typo: string; expected: string; category: string }[] = [];
  while (out.length < count) {
    const word = pick(words);
    const i = Math.floor(random() * (word.length - 1));
    const category = pick(['transposition', 'omission', 'duplication', 'adjacent-key', 'adjacent-insertion']);
    const typo =
      category === 'transposition' ? word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2)
      : category === 'omission' ? word.slice(0, i) + word.slice(i + 1)
      : category === 'duplication' ? word.slice(0, i + 1) + word[i] + word.slice(i + 1)
      : category === 'adjacent-key' ? word.slice(0, i) + pick([...NEIGHBOURS[word[i]]]) + word.slice(i + 1)
      : word.slice(0, i + 1) + pick([...NEIGHBOURS[word[i]]]) + word.slice(i + 1);
    // Typos that happen to be real words need context to fix; out of scope here.
    if (typo !== word && !lexicon.isKnown(typo)) out.push({ typo, expected: word, category });
  }
  return out;
}

const timings: number[] = [];
function timedCheck(engine: AutocorrectEngine, before: string, word: string, after: string) {
  const start = performance.now();
  const result = engine.check({ before, word, after });
  timings.push(performance.now() - start);
  return result;
}

function scoreTypos(engine: AutocorrectEngine, typos: { before?: string; typo: string; expected: string }[]) {
  let fixed = 0;
  let wrong = 0;
  for (const { before, typo, expected } of typos) {
    const r = timedCheck(engine, before ?? 'a ', typo, ' ');
    if (!r) continue;
    if (r.replacement === expected) fixed++;
    else wrong++;
  }
  return { recall: fixed / typos.length, precision: fixed + wrong ? fixed / (fixed + wrong) : 1, fixed, wrong, total: typos.length };
}

function scoreClean(engine: AutocorrectEngine) {
  let words = 0;
  const falseCorrections: string[] = [];
  for (const line of cleanLines) {
    for (const m of line.matchAll(/[A-Za-z']+/g)) {
      words++;
      const before = line.slice(0, m.index);
      const after = line.slice(m.index + m[0].length).replace(/^([.,;:!?)"']*).*$/, '$1') + ' ';
      const r = timedCheck(engine, before, m[0], after);
      if (r) falseCorrections.push(`${m[0]} -> ${r.replacement}`);
    }
  }
  return { words, falseCorrections, per1000: (falseCorrections.length / words) * 1000 };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const synthetic = syntheticTypos(2000);
/** Typos of uncommon words (low lexicon prior): where the modes differ most. */
const syntheticRare = syntheticTypos(1000, 10, 500);

for (const mode of ['conservative', 'balanced', 'aggressive'] as Mode[]) {
  timings.length = 0;
  const engine = new AutocorrectEngine(lexicon, { mode, bigrams });
  const noContext = new AutocorrectEngine(lexicon, { mode });
  const hand = scoreTypos(engine, handTypos);
  const synth = scoreTypos(engine, synthetic);
  const rare = scoreTypos(engine, syntheticRare);
  const ctx = scoreTypos(engine, contextTypos);
  const ctxPlain = scoreTypos(noContext, contextTypos);
  const clean = scoreClean(engine);
  timings.sort((a, b) => a - b);
  const q = (p: number) => timings[Math.floor(p * (timings.length - 1))].toFixed(3);

  console.log(`\n## ${mode}`);
  console.log(`hand-written typos  recall ${pct(hand.recall)} (${hand.fixed}/${hand.total})  precision ${pct(hand.precision)}  wrong ${hand.wrong}`);
  console.log(`synthetic typos     recall ${pct(synth.recall)} (${synth.fixed}/${synth.total})  precision ${pct(synth.precision)}  wrong ${synth.wrong}`);
  console.log(`rare-word typos     recall ${pct(rare.recall)} (${rare.fixed}/${rare.total})  precision ${pct(rare.precision)}  wrong ${rare.wrong}`);
  console.log(`context typos       recall ${pct(ctx.recall)} (${ctx.fixed}/${ctx.total})  wrong ${ctx.wrong}  [without context: ${pct(ctxPlain.recall)}, wrong ${ctxPlain.wrong}]`);
  console.log(`clean text          ${clean.falseCorrections.length} false corrections in ${clean.words} words (${clean.per1000.toFixed(2)} per 1,000)`);
  for (const f of clean.falseCorrections) console.log(`  false: ${f}`);
  console.log(`latency per word    median ${q(0.5)} ms  p95 ${q(0.95)} ms`);

  const missed = handTypos.filter(({ typo, expected }) => engine.check({ before: 'a ', word: typo, after: ' ' })?.replacement !== expected);
  if (missed.length) console.log(`  missed hand-written: ${missed.map((t) => t.typo).join(', ')}`);
}
