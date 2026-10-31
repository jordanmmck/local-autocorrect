# To do

Small, concrete next steps. The bigger picture lives in [docs/PLAN.md](docs/PLAN.md).

## Now

- [ ] **Try it on real writing.** Install the extension (see the README) and journal with it for a few days. Corrected words are underlined, so you can see what changed. Note anything that should go in the lists below:
  - words it changed that it shouldn't have (most important)
  - obvious typos it missed
  - whether one Cmd+Z feels right for undoing a correction

## Next

- [ ] **Tune the visual cue.** The default is a soft flash plus a faint dotted underline, with Revert in the hover. Decide whether it's too much or too little. Other ideas to try: an underline that fades after a minute, or a gutter dot per line.
- [ ] **Run-together words:** `thisis` → `this is`. Needs care around brand names like `youtube`.
- [ ] **Remember reverted corrections across sessions**, as an opt-in list of words. Never store typing history.
- [ ] **Optional sentence-start capitalisation**, off by default. Some people journal in lowercase on purpose.
- [ ] **Workspace exclusions** and a default keybinding for toggling.

## Later

- [ ] **A bigger, more realistic evaluation set** (Milestone 4): real typing errors, more clean prose, informal writing.
- [ ] **Publish** once it has held up in real use: add an icon, `"preview": true` and a CHANGELOG, then publish to the VS Code Marketplace and Open VSX (for Cursor and VSCodium) from a GitHub Action when a release is tagged. Needs a Marketplace publisher (`jordanmmck`), an Open VSX account, and their tokens added as repo secrets.
- [ ] **Context-aware correction** (Milestone 3): real-word errors like `I don't thing so` → `think`. Benchmark small local models before choosing one.

## Done

- [x] Deterministic autocorrect baseline (Milestone 1)
- [x] Profanity and informal words
- [x] `i` → `I`, apostrophe-less contractions
- [x] Visual cue for corrected words (flash, underline, hover with Revert)
