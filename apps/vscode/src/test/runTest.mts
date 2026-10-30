// Launches a real VS Code instance with this extension loaded and runs the
// Mocha suite in out/suite. Set VSCODE_EXECUTABLE to use an installed build
// instead of downloading one into .vscode-test/.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runTests } from '@vscode/test-electron';

const root = resolve(import.meta.dirname, '../..');

// A throwaway profile. Chat and the secondary sidebar are disabled because
// they open after startup and steal keyboard focus from the editor under test.
const userDataDir = mkdtempSync(join(tmpdir(), 'autocorrect-test-'));
mkdirSync(join(userDataDir, 'User'));
writeFileSync(
  join(userDataDir, 'User', 'settings.json'),
  JSON.stringify({
    'chat.disableAIFeatures': true,
    'workbench.secondarySideBar.defaultVisibility': 'hidden',
    'workbench.startupEditor': 'none',
  }),
);

try {
  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: join(root, 'out/suite/index.js'),
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE,
    launchArgs: ['--disable-extensions', '--user-data-dir', userDataDir],
  });
} catch (err) {
  console.error(err);
  process.exit(1);
}
