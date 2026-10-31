# Third-party notices

The extension bundles a word list (`en-US.tsv`) generated at build time, and a word-pair table (`bigrams-en.tsv`), from the following data.

## SCOWL (Spell Checker Oriented Word Lists)

Obtained through the [`wordlist-english`](https://github.com/jacksonrayhamilton/wordlist-english) npm package (MIT).

> Copyright 2000-2016 by Kevin Atkinson
>
> Permission to use, copy, modify, distribute and sell these word lists, the associated scripts, the output created from the scripts, and its documentation for any purpose is hereby granted without fee, provided that the above copyright notice appears in all copies and that both that copyright notice and this permission notice appear in supporting documentation. Kevin Atkinson makes no representations about the suitability of this array for any purpose. It is provided "as is" without express or implied warranty.

SCOWL incorporates further sources with their own notices. The full text ships with the extension as `SCOWL-COPYRIGHT.txt`.

## SUBTLEX-US word frequencies

Obtained through the [`subtlex-word-frequencies`](https://github.com/words/subtlex-word-frequencies) npm package (ISC).

Brysbaert, M., & New, B. (2009). Moving beyond Kučera and Francis: A critical evaluation of current word frequency norms and the introduction of a new and improved word frequency measure for American English. *Behavior Research Methods, 41*(4), 977–990.

## Google Web Trillion Word Corpus bigram counts

`bigrams-en.tsv` is derived from `count_2w.txt` and `count_1w.txt`, bigram and unigram counts from the Google Web Trillion Word Corpus, [published by Peter Norvig](https://norvig.com/ngrams/) as part of the data for the chapter "Natural Language Corpus Data" in *Beautiful Data* (Segaran & Hammerbacher, 2009).

Brants, T., & Franz, A. (2006). *Web 1T 5-gram Version 1.* Linguistic Data Consortium.
