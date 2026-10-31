import * as vscode from 'vscode';
import type { CueStyle } from './config.ts';

export interface TrackedCorrection {
  readonly id: number;
  readonly document: vscode.TextDocument;
  /** Where the replacement text is now; kept up to date as the document changes. */
  range: vscode.Range;
  readonly original: string;
  readonly replacement: string;
  /** False once the corrected text has been edited, reverted or undone. */
  live: boolean;
}

/** Older corrections stop being tracked (and underlined) beyond this many per document. */
const MAX_PER_DOCUMENT = 500;
/** Opacity of the flash tint at each step; the flash holds briefly, then fades out. */
const FLASH_ALPHAS = [0.3, 0.3, 0.3, 0.26, 0.22, 0.18, 0.14, 0.1, 0.06, 0.03];
const FLASH_STEP_MS = 110;

/**
 * Remembers recent corrections (in memory only), keeps their ranges in step
 * with edits, and draws the visual cue: a short fading flash and/or a faint
 * dotted underline whose hover shows the original word.
 */
export class CorrectionTracker implements vscode.Disposable {
  #style: CueStyle;
  #byDocument = new Map<vscode.TextDocument, TrackedCorrection[]>();
  #nextId = 1;
  #flashing = new Map<TrackedCorrection, number>();
  /** Documents whose editors currently show flash decorations that a render must clear. */
  #flashedDocuments = new Set<vscode.TextDocument>();
  #flashTimer: ReturnType<typeof setInterval> | undefined;
  #underline = vscode.window.createTextEditorDecorationType({
    // The text-decoration value is injected into CSS, which is the only way to
    // give the underline its own colour and offset.
    light: { textDecoration: 'underline dotted rgba(0, 110, 200, 0.55); text-underline-offset: 3px' },
    dark: { textDecoration: 'underline dotted rgba(90, 160, 255, 0.55); text-underline-offset: 3px' },
  });
  #flashTypes = FLASH_ALPHAS.map((alpha) =>
    vscode.window.createTextEditorDecorationType({
      light: { backgroundColor: `rgba(0, 120, 212, ${alpha})` },
      dark: { backgroundColor: `rgba(55, 148, 255, ${alpha})` },
      borderRadius: '2px',
    }),
  );
  #subscriptions: vscode.Disposable[];

  constructor(style: CueStyle) {
    this.#style = style;
    this.#subscriptions = [
      vscode.workspace.onDidChangeTextDocument((e) => this.#onChange(e)),
      vscode.workspace.onDidCloseTextDocument((doc) => this.#forget(doc)),
      // Decorations are lost when an editor is hidden, so redraw when it reappears.
      vscode.window.onDidChangeVisibleTextEditors(() => this.#renderAll()),
    ];
  }

  setStyle(style: CueStyle): void {
    this.#style = style;
    if (style === 'none' || style === 'underline') {
      this.#flashing.clear();
      this.#stopTimerIfIdle();
    }
    this.#renderAll();
  }

  add(document: vscode.TextDocument, range: vscode.Range, original: string, replacement: string): TrackedCorrection {
    const entry: TrackedCorrection = { id: this.#nextId++, document, range, original, replacement, live: true };
    const list = this.#byDocument.get(document) ?? [];
    list.push(entry);
    if (list.length > MAX_PER_DOCUMENT) list.shift()!.live = false;
    this.#byDocument.set(document, list);
    if (this.#style === 'flash' || this.#style === 'flashAndUnderline') this.#startFlash(entry);
    this.#render(document);
    return entry;
  }

  get(id: number): TrackedCorrection | undefined {
    for (const list of this.#byDocument.values()) {
      const entry = list.find((e) => e.id === id);
      if (entry) return entry;
    }
    return undefined;
  }

  dispose(): void {
    clearInterval(this.#flashTimer);
    for (const d of [...this.#subscriptions, this.#underline, ...this.#flashTypes]) d.dispose();
  }

  #forget(document: vscode.TextDocument): void {
    this.#byDocument.delete(document);
    this.#flashedDocuments.delete(document);
    for (const entry of this.#flashing.keys()) if (entry.document === document) this.#flashing.delete(entry);
    this.#stopTimerIfIdle();
  }

  #stopTimerIfIdle(): void {
    if (this.#flashing.size || this.#flashTimer === undefined) return;
    clearInterval(this.#flashTimer);
    this.#flashTimer = undefined;
  }

  #onChange(e: vscode.TextDocumentChangeEvent): void {
    const list = this.#byDocument.get(e.document);
    if (!list?.length || !e.contentChanges.length) return;
    // Apply changes from the bottom of the document up, so each change's range
    // is still valid in the coordinates we are updating.
    const changes = [...e.contentChanges].sort((a, b) => b.range.start.compareTo(a.range.start));
    for (const entry of list) {
      for (const change of changes) {
        if (change.range.start.isAfterOrEqual(entry.range.end)) continue;
        if (change.range.end.isBeforeOrEqual(entry.range.start)) {
          entry.range = new vscode.Range(shift(entry.range.start, change), shift(entry.range.end, change));
          continue;
        }
        entry.live = false; // the corrected word itself was edited
        break;
      }
    }
    const live = list.filter((entry) => entry.live);
    if (live.length !== list.length) this.#byDocument.set(e.document, live);
    this.#render(e.document);
  }

  #startFlash(entry: TrackedCorrection): void {
    this.#flashing.set(entry, 0);
    this.#flashTimer ??= setInterval(() => this.#stepFlash(), FLASH_STEP_MS);
  }

  #stepFlash(): void {
    const documents = new Set<vscode.TextDocument>();
    for (const [entry, step] of this.#flashing) {
      documents.add(entry.document);
      if (step + 1 >= FLASH_ALPHAS.length || !entry.live) this.#flashing.delete(entry);
      else this.#flashing.set(entry, step + 1);
    }
    this.#stopTimerIfIdle();
    for (const doc of documents) this.#render(doc);
  }

  #renderAll(): void {
    for (const editor of vscode.window.visibleTextEditors) this.#render(editor.document);
  }

  #render(document: vscode.TextDocument): void {
    const live = this.#byDocument.get(document) ?? [];
    const underlined = this.#style === 'underline' || this.#style === 'flashAndUnderline' ? live : [];
    const flashRanges = new Map<number, vscode.Range[]>();
    for (const [entry, step] of this.#flashing) {
      if (entry.document !== document || !entry.live) continue;
      const ranges = flashRanges.get(step);
      if (ranges) ranges.push(entry.range);
      else flashRanges.set(step, [entry.range]);
    }
    // When a document's flashes end, one last pass clears the tints; after that
    // the per-step loop is skipped so ordinary typing only redraws underlines.
    const drawFlashes = flashRanges.size > 0 || this.#flashedDocuments.has(document);
    if (flashRanges.size) this.#flashedDocuments.add(document);
    else this.#flashedDocuments.delete(document);
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document !== document) continue;
      editor.setDecorations(this.#underline, underlined.map((entry) => ({ range: entry.range, hoverMessage: hover(entry) })));
      if (drawFlashes) this.#flashTypes.forEach((type, step) => editor.setDecorations(type, flashRanges.get(step) ?? []));
    }
  }
}

function hover(entry: TrackedCorrection): vscode.MarkdownString {
  const args = encodeURIComponent(JSON.stringify([entry.id]));
  const md = new vscode.MarkdownString(
    `Autocorrected from **${entry.original}** · [Revert](command:autocorrect.revertCorrection?${args} "Restore what you typed")`,
  );
  md.isTrusted = { enabledCommands: ['autocorrect.revertCorrection'] };
  return md;
}

/** Where `position` (after `change`) ends up once `change` is applied. */
function shift(position: vscode.Position, change: vscode.TextDocumentContentChangeEvent): vscode.Position {
  const lines = change.text.split('\n');
  const lineDelta = lines.length - 1 - (change.range.end.line - change.range.start.line);
  if (position.line !== change.range.end.line) return position.translate(lineDelta, 0);
  const insertedEnd = lines.length === 1 ? change.range.start.character + change.text.length : lines[lines.length - 1].length;
  return new vscode.Position(position.line + lineDelta, insertedEnd + position.character - change.range.end.character);
}
