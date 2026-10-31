/**
 * Rules that decide whether a word is ordinary prose that may be corrected.
 * Everything here errs towards leaving text alone.
 */

export type CaseShape = 'lower' | 'capitalized' | 'upper' | 'mixed';

export function caseShape(word: string): CaseShape {
  if (word === word.toLowerCase()) return 'lower';
  if (word === word.toUpperCase()) return 'upper';
  const rest = word.slice(1);
  if (word[0] === word[0].toUpperCase() && rest === rest.toLowerCase()) return 'capitalized';
  return 'mixed';
}

export function applyCaseShape(word: string, shape: CaseShape): string {
  return shape === 'capitalized' ? word[0].toUpperCase() + word.slice(1) : word;
}

const OPENING = `(["'“‘[{`;
const CLOSING_THEN_SPACE = /^[.,;:!?)\]}"'”’]*(\s|$)/;

/**
 * True when the word stands alone rather than being part of a larger token
 * such as a URL, path, email address, identifier or `inline.code`.
 */
export function isStandaloneWord(before: string, after: string): boolean {
  const last = before.at(-1);
  if (last !== undefined && !/\s/.test(last) && !OPENING.includes(last)) return false;
  return CLOSING_THEN_SPACE.test(after);
}

/** True at the start of a line, after a list/heading/quote marker, or after sentence-ending punctuation. */
export function isSentenceStart(before: string): boolean {
  return /^\s*(([#>*+-]+|\d+[.)])\s+)*["'(“‘]?$/.test(before) || /[.!?]["')”’]*\s+["'(“‘]?$/.test(before);
}

/**
 * Lowercase words that are fine as written even though the dictionary does
 * not know them: chat shorthand, plus technical vocabulary that often turns
 * up in notes.
 */
export const PROTECTED_WORDS = new Set([
  'afaik', 'btw', 'fwiw', 'idk', 'imho', 'imo', 'irl', 'lmao', 'omg', 'smh', 'wtf',
  'api', 'apis', 'async', 'auth', 'backend', 'bool', 'cli', 'config', 'configs', 'const', 'css', 'deliverables',
  'dev', 'devs', 'diff', 'dns', 'env', 'eslint', 'faq', 'frontend', 'func', 'github', 'gitlab', 'gmail', 'hiit',
  'html', 'http', 'https', 'ide', 'impl', 'init', 'io', 'js', 'json', 'jsx', 'lol', 'markdown', 'matcha', 'nextjs',
  'npm', 'oauth', 'ok', 'onboarding', 'param', 'params', 'pnpm', 'postgres', 'pytorch', 'readme', 'reddit',
  'regex', 'repo', 'repos', 'sql', 'src', 'ssh', 'struct', 'sudo', 'tbh', 'todo', 'todos', 'tsx', 'ui', 'url',
  'urls', 'utils', 'vscode', 'webhook', 'webhooks', 'wordle', 'www', 'yaml', 'yml',
]);

/**
 * True if the end of `textBefore` lies inside a fenced code block or an
 * inline code span in a Markdown document.
 */
export function isInsideMarkdownCode(textBefore: string): boolean {
  const lines = textBefore.split(/\r?\n/);
  const current = lines.pop() ?? '';
  let fence: string | undefined;
  for (const line of lines) {
    const match = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (!match) continue;
    if (fence === undefined) fence = match[1];
    else if (match[1][0] === fence[0] && match[1].length >= fence.length) fence = undefined;
  }
  if (fence !== undefined) return true;
  return (current.match(/`/g)?.length ?? 0) % 2 === 1;
}
