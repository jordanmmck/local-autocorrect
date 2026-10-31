import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { bigrams, correctLast, engine, lexicon } from './helpers.ts';
import { parseBigrams } from '../src/bigrams.ts';
import { CONTRACTIONS, TYPO_TABLE } from '../src/typos.ts';

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

describe('aggressive mode', () => {
  const e = engine({ mode: 'aggressive' });
  // Rare words score below the minScore floor; aggressive fixes them anyway
  // when the slip is plausible and the candidate has no real competition.
  for (const [typo, expected] of [
    ['entropyy', 'entropy'],
    ['timelin', 'timeline'],
    ['signifant', 'significant'],
  ]) {
    test(`${typo} -> ${expected}`, () => assert.equal(correctLast(e, `a ${typo}`), expected));
  }

  test('rare words stay untouched in balanced mode', () => {
    assert.equal(correctLast(engine({ mode: 'balanced' }), 'a entropyy'), undefined);
  });

  test('a lone far-fetched candidate is not taken', () => {
    // Each is one implausible edit away from a real word ("changeling", "Ethereal").
    assert.equal(correctLast(e, 'a changelog'), undefined);
    assert.equal(correctLast(e, 'Ethereum'), undefined);
  });
});

describe('bigram context', () => {
  const e = engine({ bigrams });

  test('parseBigrams reads prev/word/ppm lines', () => {
    const b = parseBigrams('as\twell\t12000\nper\tcapita\t500\n');
    assert.equal(b.prob('as', 'well'), 0.012);
    assert.equal(b.prob('per', 'capita'), 0.0005);
    assert.equal(b.prob('as', 'capita'), 0);
  });

  test('context picks the word that fits the previous one', () => {
    // Without context "we" outscores "well" and is rejected for being short.
    assert.equal(correctLast(engine(), 'as wel'), undefined);
    assert.equal(correctLast(e, 'as wel'), 'well');
  });

  test('context lifts a rare word over a common wrong candidate', () => {
    // Without context "timeline" (prior 1) cannot clear the score floor.
    const balanced = engine({ mode: 'balanced', bigrams });
    assert.equal(correctLast(engine({ mode: 'balanced' }), 'a timelin'), undefined);
    assert.equal(correctLast(balanced, 'a timelin'), 'timeline');
  });

  test('punctuation between the words breaks the context', () => {
    assert.equal(engine({ bigrams }).check({ before: 'as. ', word: 'wel', after: ' ' }), null);
  });

  test('context never creates corrections of valid words', () => {
    for (const w of ['Ethereum', 'useState', 'the', 'than']) {
      assert.equal(correctLast(engine({ mode: 'aggressive', bigrams }), `more ${w}`), undefined, w);
    }
  });

  test('an engine without bigrams behaves as before', () => {
    assert.equal(correctLast(engine(), 'as wel'), undefined);
    assert.equal(correctLast(engine(), 'a becuse'), 'because');
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
  test('slip keys are non-words and values are words', () => {
    for (const [typo, fix] of Object.entries(TYPO_TABLE)) {
      if (typo in CONTRACTIONS) continue;
      assert.ok(!lexicon.isKnown(typo), `${typo} is a real word`);
      for (const part of fix.split(' ')) assert.ok(lexicon.isKnown(part), `${part} is not in the lexicon`);
    }
  });

  test('contraction keys are the contraction minus its apostrophe, and rare as words', () => {
    for (const [typo, fix] of Object.entries(CONTRACTIONS)) {
      assert.equal(typo, fix.replace("'", '').toLowerCase());
      assert.ok(lexicon.prior(typo) < 200, `${typo} is too common a word to replace`);
    }
  });

  test('common words that look like contractions are left alone', () => {
    const e = engine();
    for (const w of ['its', 'were', 'well', 'ill', 'lets', 'hell', 'shell', 'id']) assert.equal(correctLast(e, `a ${w}`), undefined, w);
  });
});

describe('the pronoun I', () => {
  const e = engine();
  test('i -> I', () => assert.equal(correctLast(e, 'and then i'), 'I'));
  test('i before punctuation', () => assert.equal(e.check({ before: 'so ', word: 'i', after: ', ' })?.replacement, 'I'));
  for (const [typed, expected] of [["i'm", "I'm"], ["i've", "I've"], ["i'll", "I'll"], ["i'd", "I'd"], ['im', "I'm"], ['ive', "I've"]]) {
    test(`${typed} -> ${expected}`, () => assert.equal(correctLast(e, `so ${typed}`), expected));
  }
  test('Im at sentence start', () => assert.equal(correctLast(e, 'Im'), "I'm"));
  test('(i) list markers are left alone', () => assert.equal(e.check({ before: 'see (', word: 'i', after: ') ' }), null));
  test('i.e. is left alone', () => assert.equal(e.check({ before: 'i.', word: 'e', after: '. ' }), null));
  test('other single letters are left alone', () => assert.equal(correctLast(e, 'plan a'), undefined));
  test('a reverted i stays lowercase', () => {
    const e2 = engine();
    e2.suppress('i');
    assert.equal(correctLast(e2, 'and i'), undefined);
  });
});
