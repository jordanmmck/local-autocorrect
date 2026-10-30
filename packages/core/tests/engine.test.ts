import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { correctLast, engine, lexicon } from './helpers.ts';
import { TYPO_TABLE } from '../src/typos.ts';

describe('MVP acceptance cases', () => {
  const e = engine();
  for (const [line, expected] of [
    ['teh', 'the'],
    ['recieve', 'receive'],
    ['thnk', 'think'],
    ['I woudl', 'would'],
  ]) {
    test(`${line} -> ${expected}`, () => assert.equal(correctLast(e, line), expected));
  }

  test('Ethereum is left alone', () => assert.equal(correctLast(e, 'I like Ethereum'), undefined));
  test('Ethereum at sentence start is left alone', () => assert.equal(correctLast(e, 'Ethereum'), undefined));
  test('useState is left alone', () => assert.equal(correctLast(e, 'call useState'), undefined));
  test('URL is left alone', () => {
    assert.equal(e.check({ before: 'see https://example.', word: 'com', after: ' ' }), null);
    assert.equal(e.check({ before: 'see ', word: 'https', after: '://example.com ' }), null);
  });
});

describe('dictionary corrections', () => {
  const e = engine();
  for (const [typo, expected] of [
    ['imprvoe', 'improve'],
    ['sentance', 'sentence'],
    ['becuse', 'because'],
    ['wrod', 'word'],
    ['thhe', 'the'],
  ]) {
    test(`${typo} -> ${expected}`, () => assert.equal(correctLast(e, `a ${typo}`), expected));
  }

  test('known words are untouched', () => {
    for (const w of ['the', 'think', 'thank', 'receive', 'colour', 'color', 'gonna']) assert.equal(correctLast(e, w), undefined, w);
  });

  test('ambiguous typos are untouched in conservative mode', () => {
    // "tha" could be "the", "that", "than", "thai"...
    assert.equal(correctLast(e, 'tha'), undefined);
  });
});

describe('profanity', () => {
  const e = engine();
  test('swear words are never corrected away', () => {
    for (const w of ['fuck', 'fucking', 'fuckin', 'shit', 'bullshit', 'asshole', 'motherfucker', 'goddamn', 'clusterfuck', 'shitshow', 'dumbass']) {
      assert.equal(correctLast(e, `a ${w}`), undefined, w);
    }
  });
  for (const [typo, expected] of [
    ['fuckign', 'fucking'],
    ['fukcing', 'fucking'],
    ['fcuk', 'fuck'],
    ['shti', 'shit'],
    ['bullshti', 'bullshit'],
    ['assohle', 'asshole'],
    ['motherfukcer', 'motherfucker'],
  ]) {
    test(`${typo} -> ${expected}`, () => assert.equal(correctLast(e, `a ${typo}`), expected));
  }
});

describe('case handling', () => {
  const e = engine();
  test('capitalised at sentence start keeps capital', () => assert.equal(correctLast(e, 'Teh'), 'The'));
  test('capitalised after a full stop keeps capital', () => assert.equal(correctLast(e, 'Done. Teh'), 'The'));
  test('capitalised mid-sentence is treated as a name', () => assert.equal(correctLast(e, 'ask Teh'), undefined));
  test('all caps is left alone', () => assert.equal(correctLast(e, 'TEH'), undefined));
  test('mixed case is left alone', () => assert.equal(correctLast(e, 'tEh'), undefined));
});

describe('token boundaries', () => {
  const e = engine();
  test('word followed by punctuation', () => assert.equal(e.check({ before: '', word: 'teh', after: ', ' })?.replacement, 'the'));
  test('word inside a path', () => assert.equal(e.check({ before: 'src/', word: 'teh', after: ' ' }), null));
  test('word inside an email', () => assert.equal(e.check({ before: 'me@', word: 'teh', after: '.com ' }), null));
  test('word directly followed by more text', () => assert.equal(e.check({ before: '', word: 'teh', after: '.foo ' }), null));
  test('word in parentheses', () => assert.equal(e.check({ before: '(', word: 'teh', after: ') ' })?.replacement, 'the'));
  test('words with digits or underscores', () => {
    assert.equal(correctLast(e, 'teh2'), undefined);
    assert.equal(e.check({ before: 'my_', word: 'teh', after: ' ' }), null);
  });
  test('contractions are left alone', () => assert.equal(correctLast(e, "wouldn't"), undefined));
});

describe('personalisation', () => {
  test('user words are never corrected', () => assert.equal(correctLast(engine({ userWords: ['Teh'] }), 'teh'), undefined));
  test('suppressed words are never corrected again', () => {
    const e = engine();
    e.suppress('teh');
    assert.equal(correctLast(e, 'teh'), undefined);
  });
  test('protected technical words are left alone', () => assert.equal(correctLast(engine(), 'the repo'), undefined));
});

describe('typo table', () => {
  test('keys are non-words and values are words', () => {
    for (const [typo, fix] of Object.entries(TYPO_TABLE)) {
      if (fix.includes("'")) {
        assert.equal(typo, fix.replace("'", ''), `${typo} should be ${fix} without its apostrophe`);
        continue;
      }
      assert.ok(!lexicon.isKnown(typo), `${typo} is a real word`);
      for (const part of fix.split(' ')) assert.ok(lexicon.isKnown(part), `${part} is not in the lexicon`);
    }
  });
});
