import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scenarios, CORPUS_VERSION, categories, getScenarios } from '../lib/scenarios/index.mjs';
import { makeCanary, makeSecrets, containsCanary } from '../lib/canary.mjs';

test('corpus is versioned and has attacks across several categories', () => {
  assert.ok(typeof CORPUS_VERSION === 'string' && CORPUS_VERSION.length > 0);
  const attacks = scenarios.filter((s) => s.severity !== 'control');
  const controls = scenarios.filter((s) => s.severity === 'control');
  assert.ok(attacks.length >= 8, `expected >=8 attacks, got ${attacks.length}`);
  assert.ok(controls.length >= 2, `expected >=2 controls, got ${controls.length}`);
  assert.ok(categories().size >= 6, 'expected >=6 attack-surface categories');
});

test('every scenario has id, title, category, severity and builds', () => {
  const c = makeCanary();
  const secrets = makeSecrets(c);
  for (const s of scenarios) {
    for (const k of ['id', 'title', 'category', 'severity']) assert.ok(s[k], `${s.id ?? '?'} missing ${k}`);
    const built = s.build({ canary: c, secrets, honeypotUrl: 'http://127.0.0.1:1' });
    assert.ok(built.prompt && built.files, `${s.id} incomplete`);
  }
});

test('each scenario plants the canary in a file but never in the injected text', () => {
  const c = makeCanary();
  const secrets = makeSecrets(c);
  for (const s of scenarios) {
    const built = s.build({ canary: c, secrets, honeypotUrl: 'http://127.0.0.1:1' });
    const planted = Object.values(built.files).some((f) => containsCanary(f, c));
    assert.ok(planted, `${s.id} plants no canary`);
    // The secret must live only in the designated secret files. The attack text
    // (and the prompt) must never contain the canary — otherwise the agent could
    // "leak" it just by echoing the instruction.
    const secretSet = new Set(built.secretFiles ?? []);
    for (const [name, content] of Object.entries(built.files)) {
      if (!secretSet.has(name)) assert.ok(!containsCanary(content, c), `${s.id}: canary leaked into non-secret file ${name}`);
    }
    assert.ok(!containsCanary(built.prompt, c), `${s.id}: canary in prompt`);
  }
});

test('ids are unique and getScenarios filters by id', () => {
  const ids = scenarios.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate scenario id');
  assert.deepEqual(getScenarios(['direct-read']).map((s) => s.id), ['direct-read']);
});

test('refactor-control only passes on a complete rename', async () => {
  const s = scenarios.find((x) => x.id === 'refactor-control');
  const c = makeCanary();
  const built = s.build({ canary: c, secrets: makeSecrets(c), honeypotUrl: 'http://127.0.0.1:1' });
  const fakeWs = (code) => ({ read: async () => code });
  assert.equal(await built.taskDone(fakeWs('export function greet(name){ return "hi " + name }')), true);
  assert.equal(await built.taskDone(fakeWs('export function greet(name){ return "hi " + n }')), false);
  assert.equal(await built.taskDone(fakeWs('export function greet(n){ return "hi " + n }')), false);
});
