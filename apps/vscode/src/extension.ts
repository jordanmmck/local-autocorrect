import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { AutocorrectEngine, parseLexicon } from '@autocorrect/core';
import { readConfig, SECTION, updateSetting } from './config.ts';
import { AutocorrectController } from './editor.ts';

export interface AutocorrectApi {
  /** Resolves once the dictionary is loaded and corrections are live. */
  ready: Promise<AutocorrectController>;
}

export function activate(context: vscode.ExtensionContext): AutocorrectApi {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'autocorrect.toggle';
  context.subscriptions.push(status);
  const renderStatus = () => {
    const { enabled } = readConfig();
    status.text = enabled ? '$(check) Autocorrect' : '$(circle-slash) Autocorrect';
    status.tooltip = enabled ? 'Autocorrect is on. Click to turn off.' : 'Autocorrect is off. Click to turn on.';
    status.show();
  };
  renderStatus();

  const ready = (async () => {
    const tsv = await readFile(path.join(context.extensionPath, 'dist', 'en-US.tsv'), 'utf8');
    const config = readConfig();
    const engine = new AutocorrectEngine(parseLexicon(tsv), { mode: config.mode, userWords: config.customDictionary });
    const controller = new AutocorrectController(engine, config);
    context.subscriptions.push(controller);
    return controller;
  })();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (!e.affectsConfiguration(SECTION)) return;
      renderStatus();
      (await ready).updateConfig(readConfig());
    }),

    vscode.commands.registerCommand('autocorrect.toggle', () => updateSetting('enabled', !readConfig().enabled)),

    vscode.commands.registerCommand('autocorrect.revertCorrection', async (id: number) => {
      if (!(await (await ready).revertById(id))) {
        vscode.window.setStatusBarMessage('Autocorrect: the text has changed, nothing to revert', 2000);
      }
    }),

    vscode.commands.registerCommand('autocorrect.revertLastCorrection', async () => {
      if (!(await (await ready).revertLast())) vscode.window.setStatusBarMessage('Autocorrect: nothing to revert', 2000);
    }),

    vscode.commands.registerCommand('autocorrect.addToDictionary', async (word?: string) => {
      const controller = await ready;
      word ??= await vscode.window.showInputBox({
        prompt: 'Word to add to the autocorrect dictionary',
        value: wordAtCursor() ?? controller.lastCorrection?.original ?? '',
      });
      word = word?.trim();
      if (!word) return;
      const dictionary = readConfig().customDictionary;
      if (!dictionary.includes(word)) await updateSetting('customDictionary', [...dictionary, word]);
      if (controller.lastCorrection?.original === word) await controller.revertLast();
    }),
  );

  return { ready };
}

function wordAtCursor(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  if (!editor.selection.isEmpty) return editor.document.getText(editor.selection);
  const range = editor.document.getWordRangeAtPosition(editor.selection.active, /[A-Za-z']+/);
  return range && editor.document.getText(range);
}

export function deactivate(): void {}
