# Local Autocorrect for macOS (prototype)

A menu-bar daemon that applies the `@autocorrect/core` engine system-wide:
type `teh ` in Notes, Messages, Slack or a browser and it becomes `the `.

## How it works

- A Swift menu-bar app installs a **CGEventTap** and rebuilds the word you are
  typing from printable keystrokes. The buffer resets on any click, arrow or
  navigation key, Escape, Tab, Return, a modifier chord (⌘/⌃/⌥), or an app
  switch — anything that could move the caret somewhere we can't see.
- On a boundary character (space or punctuation) the word goes to a small
  **Node sidecar** ([sidecar/main.ts](sidecar/main.ts)) that runs the engine
  from `packages/core` unchanged, speaking JSON lines over stdin/stdout.
  `.` and `:` never trigger a correction — they appear inside URLs, paths and
  `e.g.` (the same rule as the VS Code extension); the word is checked at the
  next real boundary with its trailing punctuation split off.
- A correction is applied espanso-style: synthesize `word length + 1`
  backspaces, then type the replacement plus the boundary character. Injected
  events are tagged so the tap ignores them.
- **Return deliberately does not trigger a correction**, only a reset: in chat
  apps Enter sends the message, and re-typing the word plus Enter would send a
  second one.
- Nothing is ever injected while **macOS secure input** is active (password
  fields), and corrections are checked against a per-app policy (below).
- The engine runs in **conservative** mode by default — reverting is clumsier
  OS-wide than in an editor. Switch to balanced/aggressive from the menu.

## Build & run

Requires macOS 13+, Xcode command-line tools (Swift 5.9+), and Node ≥ 22.18.

```sh
# from the repo root: build the lexicon once
npm install && npm run build -w @autocorrect/core

# build and bundle the app (ad-hoc signed)
apps/macos/scripts/make-app.sh
open apps/macos/build/LocalAutocorrect.app
```

For development you can also run the bare binary (`swift build && .build/debug/LocalAutocorrectD`),
but then macOS attributes the Accessibility permission to the *terminal* that
launched it, which is confusing — prefer the `.app` bundle.

The app finds `node` via your login shell (`zsh -lc 'command -v node'`); if it
can't, set `nodePath` in the config file (below). The sidecar script path is
baked in at compile time (`#filePath`), so the app must run on the machine it
was built on — fine for a prototype; override with the
`LOCAL_AUTOCORRECT_SIDECAR` environment variable if needed.

## Permissions

The event tap (listening **and** injecting) needs **Accessibility**:

1. Launch the app — macOS shows the "would like to control this computer using
   accessibility features" prompt, or the menu-bar menu (⌨) shows
   "Accessibility permission needed" with a shortcut to the settings pane.
2. System Settings → Privacy & Security → **Accessibility** → enable
   **Local Autocorrect** (or your terminal, when running the bare binary).
3. No restart needed: the app polls and installs the tap once granted.

If you rebuild the app, macOS may require you to remove and re-add it in the
Accessibility list (the ad-hoc signature changes).

## Per-app policy

Corrections are ON by default in plain-text apps (Notes, Messages, Slack,
Mail, browsers, …) and OFF in terminals, editors/IDEs (the VS Code extension
already covers those) and password managers. See
[AppPolicy.swift](Sources/LocalAutocorrectD/AppPolicy.swift) for the built-in
list. Override per app from the menu ("Correct in <app>") or in the config:

`~/Library/Application Support/LocalAutocorrect/config.json`

```json
{
  "mode": "conservative",
  "nodePath": null,
  "apps": { "com.apple.Notes": true, "com.tinyspeck.slackmacgap": false },
  "learnedWords": []
}
```

## Revert & learn

Press **⌃⌥Z** right after an unwanted correction: the original word is
re-typed and added to `learnedWords`, so it is never corrected again
(mirroring the extension's learn-from-reverts). The revert window closes as
soon as you type anything else, click, or switch apps — OS-wide we can't see
the document, so we only undo what we know is still on screen.

## Try it

1. Launch the app and grant Accessibility.
2. Open Notes or TextEdit, type `teh ` — it becomes `the `.
3. Type a word it "fixes" wrongly, press ⌃⌥Z — the original comes back and is
   learned.
4. Open Terminal, type `teh ` — nothing happens (default-off app).

## Known prototype limitations

- If you keep typing in the few milliseconds before the sidecar replies, the
  correction is dropped (by design — better safe than garbled).
- Apps that transform text as you type (smart quotes aside, e.g. code
  completion, IME composition, Vim-style modal editing) can confuse the word
  buffer; the reset rules make this rare but not impossible.
- Corrections assume one backspace deletes one character; exotic input fields
  (rich-text tokens, terminals with line editing) may disagree — which is why
  terminals are off by default.
- Single instance isn't enforced; don't run two copies at once.
