import * as vscode from 'vscode';
import { isInsideMarkdownCode, type AutocorrectEngine, type Correction } from '@autocorrect/core';
import type { Config } from './config.ts';
import { CorrectionTracker, type TrackedCorrection } from './cue.ts';

/** A single typed character (or Enter, with auto-indent) that completes the preceding word. */
const BOUNDARY = /^([ \t,;!?)\]}"]|\r?\n[ \t]*)$/;
/** The word right before the cursor, plus any sentence punctuation typed after it. */
const TRAILING_WORD = /([A-Za-z']+)([.,;:!?)\]}"'”’]*)$/;

/**
 * Watches typing in the active editor and applies corrections at word
 * boundaries.
 */
export class AutocorrectController implements vscode.Disposable {
  #engine: AutocorrectEngine;
  #config: Config;
  #tracker: CorrectionTracker;
  #last: TrackedCorrection | undefined;
  #subscription: vscode.Disposable;
  readonly onDidCorrect = new vscode.EventEmitter<Correction>();
  /** Fires with the typed word whenever the user rejects a correction (revert command, hover Revert or undo). */
  readonly onDidRevert = new vscode.EventEmitter<string>();

  constructor(engine: AutocorrectEngine, config: Config) {
    this.#engine = engine;
    this.#config = config;
    this.#tracker = new CorrectionTracker(config.correctionCue);
    this.#subscription = vscode.workspace.onDidChangeTextDocument((e) => this.#onChange(e));
  }

  updateConfig(config: Config): void {
    this.#config = config;
    this.#engine.setMode(config.mode);
    this.#engine.setUserWords(config.customDictionary);
    this.#tracker.setStyle(config.correctionCue);
  }

  get lastCorrection(): Readonly<TrackedCorrection> | undefined {
    return this.#last;
  }

  /** Restores the original text of the most recent correction and stops making it. */
  revertLast(): Promise<boolean> {
    return this.#revert(this.#last);
  }

  /** Restores a specific earlier correction (from the hover's Revert link) and stops making it. */
  revertById(id: number): Promise<boolean> {
    return this.#revert(this.#tracker.get(id));
  }

  dispose(): void {
    this.#subscription.dispose();
    this.#tracker.dispose();
    this.onDidCorrect.dispose();
    this.onDidRevert.dispose();
  }

  async #revert(entry: TrackedCorrection | undefined): Promise<boolean> {
    if (!entry?.live || entry.document.isClosed || entry.document.getText(entry.range) !== entry.replacement) return false;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(entry.document.uri, entry.range, entry.original);
    if (!(await vscode.workspace.applyEdit(edit))) return false;
    this.#engine.suppress(entry.original);
    if (entry === this.#last) this.#last = undefined;
    this.onDidRevert.fire(entry.original);
    return true;
  }

  #onChange(e: vscode.TextDocumentChangeEvent): void {
    // Our own corrections replace a non-empty range, so they never look like a
    // typed boundary character and cannot re-trigger this handler.
    if (!this.#config.enabled) return;
    if (e.reason !== undefined) {
      this.#noteUndo(e);
      return;
    }

    const editor = vscode.window.activeTextEditor;
    const doc = e.document;
    if (!editor || editor.document !== doc || !this.#config.languages.includes(doc.languageId)) return;
    if (e.contentChanges.length !== 1) return;

    const change = e.contentChanges[0];
    if (change.rangeLength !== 0 || !BOUNDARY.test(change.text)) return;

    const insertedAt = change.range.start;
    const typedEnd = doc.positionAt(change.rangeOffset + change.text.length);

    const line = doc.lineAt(insertedAt.line).text;
    const prefix = line.slice(0, insertedAt.character);
    const match = TRAILING_WORD.exec(prefix);
    if (!match) return;

    const word = match[1];
    const wordStart = prefix.length - match[0].length;
    if (doc.languageId === 'markdown' && isInsideMarkdownCode(doc.getText(new vscode.Range(0, 0, insertedAt.line, wordStart)))) {
      return;
    }

    const correction = this.#engine.check({
      before: prefix.slice(0, wordStart),
      word,
      after: match[2] + line.slice(insertedAt.character),
    });
    if (!correction) return;

    const range = new vscode.Range(insertedAt.line, wordStart, insertedAt.line, wordStart + word.length);
    void this.#apply(editor, range, typedEnd, correction);
  }

  async #apply(editor: vscode.TextEditor, range: vscode.Range, typedEnd: vscode.Position, correction: Correction): Promise<void> {
    await selectionSettled(editor);
    // The user may keep typing before the edit lands. Re-check that the word
    // is still there and untouched; if the editor rejects the edit because the
    // document moved on, re-check and try once more.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!this.#stillApplicable(editor, range, typedEnd, correction.original)) return;
      const ok = await editor.edit((b) => b.replace(range, correction.replacement), {
        undoStopBefore: true,
        undoStopAfter: true,
      });
      if (ok) {
        const replaced = new vscode.Range(range.start, range.start.translate(0, correction.replacement.length));
        this.#last = this.#tracker.add(editor.document, replaced, correction.original, correction.replacement);
        this.onDidCorrect.fire(correction);
        return;
      }
    }
  }

  /**
   * The word is unchanged and there is a single cursor at or beyond the
   * character that completed it. A cursor anywhere else means this was not
   * ordinary typing (multi-cursor, snippet, programmatic edit, etc.).
   */
  #stillApplicable(editor: vscode.TextEditor, range: vscode.Range, typedEnd: vscode.Position, original: string): boolean {
    return (
      this.#config.enabled &&
      vscode.window.activeTextEditor === editor &&
      !editor.document.isClosed &&
      editor.document.getText(range) === original &&
      editor.selections.length === 1 &&
      editor.selection.isEmpty &&
      editor.selection.active.isAfterOrEqual(typedEnd)
    );
  }

  /** If the user undoes a correction, don't make the same one again. */
  #noteUndo(e: vscode.TextDocumentChangeEvent): void {
    const last = this.#last;
    if (e.reason !== vscode.TextDocumentChangeReason.Undo || !last || last.document !== e.document) return;
    if (e.contentChanges.some((c) => c.text === last.original && c.range.start.isEqual(last.range.start))) {
      this.#engine.suppress(last.original);
      this.#last = undefined;
      this.onDidRevert.fire(last.original);
    }
  }
}

/**
 * The extension host learns about a typed character before it learns that the
 * cursor moved. Wait (briefly) for the matching selection update.
 */
function selectionSettled(editor: vscode.TextEditor, timeoutMs = 100): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      sub.dispose();
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    const sub = vscode.window.onDidChangeTextEditorSelection((e) => e.textEditor === editor && done());
  });
}
