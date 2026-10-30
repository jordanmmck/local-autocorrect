import assert from 'node:assert/strict';
import * as vscode from 'vscode';

const EXTENSION_ID = 'jordanmmck.local-autocorrect';
/** How long to wait before concluding that no correction is coming. */
const QUIET_MS = 300;

async function open(content = '', language = 'markdown'): Promise<vscode.TextEditor> {
  const doc = await vscode.workspace.openTextDocument({ language, content });
  const editor = await vscode.window.showTextDocument(doc);
  await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
  const end = doc.positionAt(content.length);
  editor.selection = new vscode.Selection(end, end);
  return editor;
}

/** Types one character at a time through the editor, like a user would. */
async function type(text: string): Promise<void> {
  for (const ch of text) await vscode.commands.executeCommand('type', { text: ch });
}

async function textBecomes(editor: vscode.TextEditor, expected: string, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (editor.document.getText() !== expected && Date.now() < deadline) await sleep(20);
  assert.equal(editor.document.getText(), expected);
}

async function textStays(editor: vscode.TextEditor, expected: string): Promise<void> {
  await sleep(QUIET_MS);
  assert.equal(editor.document.getText(), expected);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function setConfig(key: string, value: unknown): Promise<void> {
  await vscode.workspace.getConfiguration('autocorrect').update(key, value, vscode.ConfigurationTarget.Global);
}

suite('Autocorrect in a real editor', () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    await (await ext.activate()).ready;
    // Let the workbench finish restoring its layout; until then it can move
    // keyboard focus away from the editor mid-test.
    await sleep(2000);
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await setConfig('enabled', undefined);
    await setConfig('customDictionary', undefined);
  });

  for (const [input, expected] of [
    ['teh ', 'the '],
    ['recieve ', 'receive '],
    ['thnk ', 'think '],
    ['I woudl go', 'I would go'],
    ['Teh end', 'The end'],
    ['teh, ', 'the, '],
    ['done teh.\n', 'done the.\n'],
  ]) {
    test(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, async () => {
      const editor = await open();
      await type(input);
      await textBecomes(editor, expected);
    });
  }

  for (const input of ['Ethereum ', 'useState ', 'https://example.com ', 'see Teh ', 'TEH ', 'teh']) {
    test(`${JSON.stringify(input)} is left alone`, async () => {
      const editor = await open();
      await type(input);
      await textStays(editor, input);
    });
  }

  test('keeps the cursor after the corrected word when the length changes', async () => {
    const editor = await open();
    await type('becuse ');
    await textBecomes(editor, 'because ');
    assert.equal(editor.selection.active.character, 'because '.length);
    await type('it');
    await textBecomes(editor, 'because it');
  });

  test('keeps up with fast typing', async () => {
    const editor = await open();
    await type('teh wrod is jsut fine ');
    await textBecomes(editor, 'the word is just fine ');
  });

  test('corrects a word typed in the middle of a line', async () => {
    const editor = await open(' world');
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    await type('helo teh');
    await type(' ');
    await textBecomes(editor, 'helo the  world');
  });

  // Reverting suppresses the word for the rest of the session, so these tests
  // use words that no other test relies on.
  test('undo reverts the correction, and the word is not corrected again', async () => {
    const editor = await open();
    await type('taht ');
    await textBecomes(editor, 'that ');
    await vscode.commands.executeCommand('undo');
    await textBecomes(editor, 'taht ');
    await type('taht ');
    await textStays(editor, 'taht taht ');
  });

  test('revert command restores the original word', async () => {
    const editor = await open();
    await type('shoudl ');
    await textBecomes(editor, 'should ');
    await vscode.commands.executeCommand('autocorrect.revertLastCorrection');
    await textBecomes(editor, 'shoudl ');
  });

  test('add to dictionary stops future corrections', async () => {
    const editor = await open();
    await vscode.commands.executeCommand('autocorrect.addToDictionary', 'teh');
    await type('teh ');
    await textStays(editor, 'teh ');
    await setConfig('customDictionary', undefined);
    await type('teh ');
    await textBecomes(editor, 'teh the ');
  });

  test('disabled means no corrections', async () => {
    await setConfig('enabled', false);
    const editor = await open();
    await type('teh ');
    await textStays(editor, 'teh ');
  });

  test('toggle command flips the setting', async () => {
    await vscode.commands.executeCommand('autocorrect.toggle');
    assert.equal(vscode.workspace.getConfiguration('autocorrect').get('enabled'), false);
    await vscode.commands.executeCommand('autocorrect.toggle');
    assert.equal(vscode.workspace.getConfiguration('autocorrect').get('enabled'), true);
  });

  test('works in plaintext', async () => {
    const editor = await open('', 'plaintext');
    await type('teh ');
    await textBecomes(editor, 'the ');
  });

  test('ignores languages that are not enabled', async () => {
    const editor = await open('', 'javascript');
    await type('teh ');
    await textStays(editor, 'teh ');
  });

  test('ignores fenced code in Markdown', async () => {
    const content = '```\n';
    const editor = await open(content);
    await type('teh ');
    await textStays(editor, content + 'teh ');
  });

  test('ignores inline code in Markdown', async () => {
    const editor = await open('see `');
    await type('teh ');
    await textStays(editor, 'see `teh ');
  });

  test('ignores multi-cursor typing', async () => {
    const editor = await open('teh\nteh');
    editor.selections = [new vscode.Selection(0, 3, 0, 3), new vscode.Selection(1, 3, 1, 3)];
    await type(' ');
    await textStays(editor, 'teh \nteh ');
  });

  test('ignores pasted text', async () => {
    const editor = await open();
    await editor.edit((b) => b.insert(new vscode.Position(0, 0), 'teh '));
    await textStays(editor, 'teh ');
  });
});
