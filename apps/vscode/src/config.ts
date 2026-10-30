import * as vscode from 'vscode';
import type { Mode } from '@autocorrect/core';

export const SECTION = 'autocorrect';

export interface Config {
  enabled: boolean;
  mode: Mode;
  languages: string[];
  customDictionary: string[];
  highlightCorrections: boolean;
}

export function readConfig(): Config {
  const c = vscode.workspace.getConfiguration(SECTION);
  return {
    enabled: c.get('enabled', true),
    mode: c.get<Mode>('mode', 'conservative'),
    languages: c.get('languages', ['markdown', 'plaintext']),
    customDictionary: c.get('customDictionary', []),
    highlightCorrections: c.get('highlightCorrections', false),
  };
}

/** Writes to the narrowest scope that currently defines the setting, so the change actually takes effect. */
export async function updateSetting(key: string, value: unknown): Promise<void> {
  const c = vscode.workspace.getConfiguration(SECTION);
  const inspected = c.inspect(key);
  const target =
    inspected?.workspaceFolderValue !== undefined
      ? vscode.ConfigurationTarget.WorkspaceFolder
      : inspected?.workspaceValue !== undefined
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
  await c.update(key, value, target);
}
