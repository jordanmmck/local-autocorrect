// Builds data/bigrams-en.tsv: how likely each lexicon word is to follow
// another, from the Google Web Trillion Word Corpus bigram counts published
// by Peter Norvig (https://norvig.com/ngrams/, free to use).
//
// Each line is `prev<TAB>word<TAB>ppm` where ppm is P(word | prev) in parts
// per million: count(prev word) / count(prev). Only pairs of lexicon words
// where `word` is proposable are kept, so the table stays small enough to
// ship. The result is committed; rerun this script only to regenerate it.
//
// Requires data/en-US.tsv (npm run build) and downloads the ~10MB count
// files into data/.cache on first run.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');
const cacheDir = join(dataDir, '.cache');

/** Conditional probabilities below this (in parts per million) are noise, not context. */
const MIN_PPM = 10;

async function cached(name) {
  const file = join(cacheDir, name);
  if (!existsSync(file)) {
    mkdirSync(cacheDir, { recursive: true });
    const res = await fetch(`https://norvig.com/ngrams/${name}`);
    if (!res.ok) throw new Error(`download of ${name} failed: ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return readFileSync(file, 'utf8');
}

const priors = new Map();
for (const line of readFileSync(join(dataDir, 'en-US.tsv'), 'utf8').split('\n')) {
  const tab = line.indexOf('\t');
  if (tab > 0) priors.set(line.slice(0, tab), Number(line.slice(tab + 1)));
}

const unigrams = new Map();
for (const line of (await cached('count_1w.txt')).split('\n')) {
  const [word, count] = line.split('\t');
  if (word && /^[a-z]+$/.test(word)) unigrams.set(word, Number(count));
}

// Lowercase and merge duplicate pairs; the corpus tokens are mostly lowercase
// but include capitalised and non-ASCII strays.
const pairs = new Map();
for (const line of (await cached('count_2w.txt')).split('\n')) {
  const tab = line.indexOf('\t');
  if (tab < 0) continue;
  const [prev, word] = line.slice(0, tab).toLowerCase().split(' ');
  if (!word || !/^[a-z]+$/.test(prev) || !/^[a-z]+$/.test(word)) continue;
  if (!priors.has(prev) || !(priors.get(word) > 0) || !unigrams.has(prev)) continue;
  const key = `${prev} ${word}`;
  pairs.set(key, (pairs.get(key) ?? 0) + Number(line.slice(tab + 1)));
}

const lines = [];
for (const [key, count] of pairs) {
  const [prev, word] = key.split(' ');
  const ppm = Math.min(1e6, Math.round((count / unigrams.get(prev)) * 1e6));
  if (ppm >= MIN_PPM) lines.push(`${prev}\t${word}\t${ppm}`);
}
lines.sort();

const out = join(dataDir, 'bigrams-en.tsv');
writeFileSync(out, lines.join('\n') + '\n');
console.log(`wrote ${lines.length} bigrams to ${out}`);
