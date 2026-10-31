/**
 * Correction sidecar: runs @autocorrect/core and speaks JSON lines over
 * stdin/stdout to the Swift daemon.
 *
 * Requests:  {"id": 1, "cmd": "check", "word": "teh", "before": "", "after": " "}
 *            {"id": 2, "cmd": "suppress", "word": "teh"}
 *            {"id": 3, "cmd": "setMode", "mode": "conservative"}
 *            {"id": 4, "cmd": "configure", "mode": "conservative", "learnedWords": ["zsh"]}
 * Responses: {"id": 1, "replacement": "the"}   (null when no correction)
 *            {"id": 2, "ok": true}
 * On startup it prints {"ready": true} once the lexicon is loaded.
 */
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { AutocorrectEngine, parseLexicon, type Mode } from '@autocorrect/core';

const LEXICON_URL = new URL('../../../packages/core/data/en-US.tsv', import.meta.url);
const MODES = new Set<string>(['conservative', 'balanced', 'aggressive']);

let tsv: string;
try {
  tsv = readFileSync(LEXICON_URL, 'utf8');
} catch {
  process.stdout.write(JSON.stringify({ fatal: `lexicon not found at ${LEXICON_URL.pathname}; run: npm run build -w @autocorrect/core` }) + '\n');
  process.exit(1);
}

const engine = new AutocorrectEngine(parseLexicon(tsv), { mode: 'conservative' });

interface Request {
  id?: number;
  cmd: 'check' | 'suppress' | 'setMode' | 'configure' | 'ping';
  word?: string;
  before?: string;
  after?: string;
  mode?: string;
  learnedWords?: string[];
}

function handle(req: Request): Record<string, unknown> {
  switch (req.cmd) {
    case 'check': {
      const correction = engine.check({ before: req.before ?? '', word: req.word ?? '', after: req.after ?? '' });
      return { replacement: correction?.replacement ?? null };
    }
    case 'suppress':
      if (req.word) engine.suppress(req.word);
      return { ok: true };
    case 'setMode':
      if (req.mode && MODES.has(req.mode)) engine.setMode(req.mode as Mode);
      return { ok: true };
    case 'configure':
      if (req.mode && MODES.has(req.mode)) engine.setMode(req.mode as Mode);
      for (const word of req.learnedWords ?? []) engine.suppress(word);
      return { ok: true };
    case 'ping':
      return { ok: true };
    default:
      return { error: `unknown cmd` };
  }
}

const lines = createInterface({ input: process.stdin, terminal: false });
lines.on('line', (line) => {
  if (!line.trim()) return;
  let req: Request;
  try {
    req = JSON.parse(line);
  } catch {
    process.stdout.write(JSON.stringify({ error: 'bad json' }) + '\n');
    return;
  }
  const res = handle(req);
  if (req.id !== undefined) res.id = req.id;
  process.stdout.write(JSON.stringify(res) + '\n');
});
lines.on('close', () => process.exit(0));

process.stdout.write(JSON.stringify({ ready: true }) + '\n');
