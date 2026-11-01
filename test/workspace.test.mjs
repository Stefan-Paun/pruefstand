import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace } from '../lib/workspace.mjs';

test('workspace writes files and cleans up', async () => {
  const ws = await createWorkspace({ 'a.txt': 'hi', 'sub/b.txt': 'yo' }, { git: false });
  assert.ok(await ws.exists('a.txt'));
  assert.equal(await ws.read('sub/b.txt'), 'yo');
  await ws.remove();
  assert.ok(!(await ws.exists('a.txt')));
});

test('workspace rejects path traversal', async () => {
  await assert.rejects(() => createWorkspace({ '../escape.txt': 'x' }, { git: false }));
});
