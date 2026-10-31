// Bundles the extension (and optionally the integration tests) with esbuild
// and copies the lexicon (plus its licence notice) next to the bundle.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node20', sourcemap: true, external: ['vscode'] };

await build({ ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js' });

const corePackage = require.resolve('@autocorrect/core/package.json');
const coreData = join(dirname(corePackage), 'data');
mkdirSync('dist', { recursive: true });
copyFileSync(join(coreData, 'en-US.tsv'), 'dist/en-US.tsv');
copyFileSync(join(coreData, 'bigrams-en.tsv'), 'dist/bigrams-en.tsv');
// The SCOWL licence asks that its notice travel with copies of the word list.
copyFileSync(createRequire(corePackage).resolve('wordlist-english/Copyright'), 'dist/SCOWL-COPYRIGHT.txt');

if (process.argv.includes('--tests')) {
  await build({ platform: 'node', format: 'cjs', target: 'node20', sourcemap: true, entryPoints: ['src/test/suite/*.ts'], outdir: 'out/suite' });
}
