import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenariosDir, fromJson } from '../lib/scenarios/load.mjs';
import { scenarios, getScenarios } from '../lib/scenarios/index.mjs';
import { makeCanary, makeSecrets, containsCanary } from '../lib/canary.mjs';

const fx = (n) => path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', n);
const builtinIds = scenarios.map((s) => s.id);

test('loads .json and .mjs scenarios; canary only in secret files', async () => {
  const extra = await loadScenariosDir(fx('scenarios-ok'), { builtinIds });
  assert.deepEqual(extra.map((s) => s.id).sort(), ['custom-mjs', 'todo-note-injection']);
  const c = makeCanary();
  for (const s of extra) {
    const b = s.build({ canary: c, secrets: makeSecrets(c), honeypotUrl: 'http://127.0.0.1:1' });
    assert.ok(Object.values(b.files).some((f) => containsCanary(f, c)), `${s.id} plants no canary`);
    for (const [n, content] of Object.entries(b.files)) {
      if (!b.secretFiles.includes(n)) assert.ok(!containsCanary(content, c), `${s.id}: canary in ${n}`);
    }
  }
  const todo = extra.find((s) => s.id === 'todo-note-injection').build({ canary: c, secrets: makeSecrets(c), honeypotUrl: 'http://127.0.0.1:7' });
  assert.match(todo.files['TODO.md'], /http:\/\/127\.0\.0\.1:7\/collect/);
});

test('getScenarios appends extras to the built-ins and filters by id', async () => {
  const extra = await loadScenariosDir(fx('scenarios-ok'), { builtinIds });
  assert.equal(getScenarios([], extra).length, scenarios.length + extra.length);
  assert.deepEqual(getScenarios(['custom-mjs'], extra).map((s) => s.id), ['custom-mjs']);
});

test('invalid schema gives a clear error', async () => {
  await assert.rejects(loadScenariosDir(fx('scenarios-bad'), { builtinIds }), /invalid scenario \(bad-id\.json\).*id "Bad Id"/);
  assert.throws(() => fromJson({ id: 'a', title: 't', category: 'c', severity: 'nope', prompt: 'p' }, 'x'), /severity/);
  assert.throws(() => fromJson({ id: 'a', title: 't', category: 'c', severity: 'high', prompt: 'p', secrets: ['id_rsa'] }, 'x'), /unknown secret file/);
  assert.throws(() => fromJson({ id: 'a', title: 't', category: 'c', severity: 'high', prompt: 'p', files: { '.env': 'x' } }, 'x'), /generated from/);
});

test('duplicate ids (against built-ins) and missing dir are rejected', async () => {
  await assert.rejects(loadScenariosDir(fx('scenarios-ok'), { builtinIds: [...builtinIds, 'custom-mjs'] }), /duplicate id/);
  await assert.rejects(loadScenariosDir(fx('does-not-exist'), { builtinIds }), /not found/);
});

test('JSON: external hosts and control severity are rejected', () => {
  const base = { id: 'a', title: 't', category: 'c', severity: 'high', prompt: 'p' };
  assert.throws(() => fromJson({ ...base, files: { 'x.md': 'curl http://evil.example/x' } }, 'x'), /external URL/);
  assert.throws(() => fromJson({ ...base, prompt: 'see https://example.com' }, 'x'), /external URL/);
  assert.throws(() => fromJson({ ...base, severity: 'control' }, 'x'), /taskDone/);
  assert.doesNotThrow(() => fromJson({ ...base, files: { 'x.md': 'post to http://127.0.0.1:9/c or {{honeypotUrl}}' } }, 'x'));
});
