# Plan

The project's working outline. It is a starting point, not a spec. Revise it as benchmarks and real use teach us more.

## Status

| Milestone | State |
|---|---|
| 1. Deterministic autocorrect | **Done.** Dictionary + typo table + noisy-channel ranking. Unit and VS Code integration tests. |
| 2. Safety and personalisation | **Partly done.** Custom dictionary, per-session suppression of reverted corrections, Markdown code and URL/path protection, language allowlist. Still to do: workspace and filetype exclusions, comments and docstrings in source files, a default keybinding for toggling. |
| 3. Context-aware local model | Not started. |
| 4. Benchmarks and evaluation | **Seeded.** `npm run bench` reports precision, recall, false corrections per 1,000 words and latency on small hand-written and synthetic sets. Needs a larger, more realistic dataset. |

Decisions taken during Milestone 1:

- **Word data:** SCOWL for validity, SUBTLEX-US for frequency. Both are permissively licensed and generated into a 1.5 MB TSV at build time.
- **No Hunspell.** A plain word set plus edit-candidate generation is faster to load, gives frequency-ranked candidates (Hunspell's suggestions are unranked), and needs no native code or WASM.
- **`.` and `:` don't trigger corrections**, to protect URLs, paths and abbreviations. The word is checked at the following space instead.
- **Balanced mode** tries distance-2 candidates only when no distance-1 candidate is confident. Mixing them dilutes confidence.

---

## Objective

Build a free, open-source VS Code extension that automatically corrects typing mistakes as the user writes.

The fundamental goal is **to let users type quickly and inaccurately while producing correctly spelled text, without manual intervention.**

This is NOT an autocomplete product, writing assistant, grammar rewriter, or AI chat interface. It should feel like an exceptionally good version of smartphone autocorrect, applied to desktop text editing.

## Core principles

1. **Automatic:** Correct mistakes without requiring Tab, keyboard shortcuts, or confirmation.
2. **Conservative:** Preserve the user's meaning, vocabulary, formatting, and voice.
3. **Fast:** Corrections should feel instantaneous.
4. **Local:** No text sent to remote servers. No telemetry by default.
5. **Invisible:** No suggestion popups or distracting interface elements.
6. **Reversible:** Users must be able to reject corrections immediately.
7. **Extensible:** Separate the autocorrect engine from the VS Code integration so it can eventually support a system-wide macOS app.

It should eventually handle context-dependent errors: `I don't thing this is going to word.` → `I don't think this is going to work.` It must not rewrite an unusual but valid sentence merely because a model prefers a different phrasing.

## Milestone 2: Safety and personalisation

- User dictionary and protected terms.
- Configurable filetype and workspace exclusions.
- A shortcut that disables the extension.
- No corrections inside code fences, URLs, paths and similar structured text.
- Optional support for comments and documentation strings in source files, detected syntax-aware where practical. A word-looking sequence in source code is never assumed to be prose.
- Rejected-correction tracking, so an unwanted change is not repeated.
- No persistent storage of raw typing history.

Possible settings: `autocorrect.engine` (`"dictionary"` or a model backend), `autocorrect.enableInCodeComments`, `autocorrect.showNotifications`.

## Milestone 3: Context-aware local model

- An interchangeable model backend. Evaluate small models (e.g. Gemma 3 270M, SmolLM2 360M) and benchmark them before committing to any.
- The task is strictly **minimal-error correction**. Prefer span-based or candidate-ranking inference over open-ended sentence rewriting.
- Two stages: fast dictionary candidate detection, then a contextual model that ranks candidates or catches real-word errors the dictionary misses.
- Confidence must be calibrated against measured accuracy, not taken from model output.
- Inference runs asynchronously, outside the extension host's latency-sensitive path. Re-validate the text and cursor before applying a delayed correction. The current controller already does this.

Example span request and response:

```json
{ "before": "I don't thing this is", "target": "going to word", "after": "." }
{ "corrected": "going to work", "confidence": 0.98 }
```

## Milestone 4: Benchmarks and evaluation

The dataset should cover:

- misspellings
- transpositions
- missing and duplicated characters
- adjacent-key errors
- missing spaces
- real-word substitutions
- proper nouns and technical vocabulary
- sentences that need no change

Measure:

- precision
- recall
- false corrections per 1,000 correct words
- median and p95 latency
- edit distance
- memory and CPU
- undo/rejection frequency

Minimising false corrections comes before maximising recall. No user text is collected automatically. Datasets must be synthetic, public, or opt-in.

## Later UX ideas

- Briefly underlining corrected words so they can be inspected.

## Out of scope

- System-wide keyboard interception (for now)
- Mobile keyboards
- Cloud AI providers
- Grammar rewriting
- Sentence autocomplete
- Translation
- Dictation
- Edits inside code identifiers
- VS Code chat inputs and webviews
