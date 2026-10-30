import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isInsideMarkdownCode, isSentenceStart } from '../src/safety.ts';
import { areAdjacentKeys } from '../src/spelling.ts';

describe('isInsideMarkdownCode', () => {
  test('plain prose', () => assert.equal(isInsideMarkdownCode('hello\nworld '), false));
  test('inside an open fence', () => assert.equal(isInsideMarkdownCode('text\n```js\nconst teh '), true));
  test('after a closed fence', () => assert.equal(isInsideMarkdownCode('```\ncode\n```\nteh '), false));
  test('tilde fences', () => assert.equal(isInsideMarkdownCode('~~~\nteh '), true));
  test('inline code span', () => assert.equal(isInsideMarkdownCode('use `teh '), true));
  test('closed inline code span', () => assert.equal(isInsideMarkdownCode('use `x` then teh '), false));
});

describe('isSentenceStart', () => {
  for (const s of ['', '  ', '# ', '- ', '1. ', '> ', 'Done. ', 'Really? ', '(']) {
    test(JSON.stringify(s), () => assert.equal(isSentenceStart(s), true));
  }
  for (const s of ['the ', 'Mr ', 'e.g.x ']) {
    test(`not ${JSON.stringify(s)}`, () => assert.equal(isSentenceStart(s), false));
  }
});

test('areAdjacentKeys', () => {
  assert.ok(areAdjacentKeys('e', 'r'));
  assert.ok(areAdjacentKeys('e', 'd'));
  assert.ok(!areAdjacentKeys('e', 'p'));
  assert.ok(!areAdjacentKeys('a', 'a'));
});
