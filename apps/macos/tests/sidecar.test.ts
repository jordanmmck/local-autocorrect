import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { after, before, test } from 'node:test';

const SIDECAR = new URL('../sidecar/main.ts', import.meta.url).pathname;

let child: ChildProcess;
let lines: Interface;
const pending = new Map<number, (res: Record<string, unknown>) => void>();
let nextId = 1;

function request(req: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = nextId++;
  child.stdin!.write(JSON.stringify({ id, ...req }) + '\n');
  return new Promise((resolve) => pending.set(id, resolve));
}

before(async () => {
  child = spawn(process.execPath, [SIDECAR], { stdio: ['pipe', 'pipe', 'inherit'] });
  lines = createInterface({ input: child.stdout! });
  const ready = once(lines, 'line');
  lines.on('line', (line) => {
    const res = JSON.parse(line);
    pending.get(res.id)?.(res);
    pending.delete(res.id);
  });
  assert.deepEqual(JSON.parse((await ready)[0]), { ready: true });
});

after(() => child.kill());

test('corrects a classic typo at a space boundary', async () => {
  const res = await request({ cmd: 'check', word: 'teh', before: '', after: ' ' });
  assert.equal(res.replacement, 'the');
});

test('leaves correct words alone', async () => {
  const res = await request({ cmd: 'check', word: 'the', before: '', after: ' ' });
  assert.equal(res.replacement, null);
});

test('suppress stops a word from being corrected again', async () => {
  await request({ cmd: 'suppress', word: 'teh' });
  const res = await request({ cmd: 'check', word: 'teh', before: '', after: ' ' });
  assert.equal(res.replacement, null);
});

test('configure sets mode and learned words', async () => {
  const ok = await request({ cmd: 'configure', mode: 'conservative', learnedWords: ['abotu'] });
  assert.equal(ok.ok, true);
  const res = await request({ cmd: 'check', word: 'abotu', before: '', after: ' ' });
  assert.equal(res.replacement, null);
});
