import type { Bigrams } from './types.ts';

/** Parses the `prev<TAB>word<TAB>ppm` format produced by scripts/build-bigrams.mjs. */
export function parseBigrams(tsv: string): Bigrams {
  const ppm = new Map<string, number>();
  for (const line of tsv.split('\n')) {
    const t1 = line.indexOf('\t');
    const t2 = line.indexOf('\t', t1 + 1);
    if (t1 > 0 && t2 > t1) ppm.set(line.slice(0, t1) + ' ' + line.slice(t1 + 1, t2), Number(line.slice(t2 + 1)));
  }
  return { prob: (prev, word) => (ppm.get(prev + ' ' + word) ?? 0) / 1e6 };
}
