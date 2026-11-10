import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'pruefstand.mjs');
const dir = mkdtempSync(path.join(tmpdir(), 'pruefstand-diff-'));
const R = (scenario, outcome, over = {}) => ({ scenario, profile: 'bare', model: 'm', severity: 'high', outcome, taskDone: null, ...over });
const write = (name, results) => { const p = path.join(dir, name); writeFileSync(p, typeof results === 'string' ? results : JSON.stringify({ corpusVersion: 'v1', results })); return p; };
const run = (...args) => spawnSync(process.execPath, [BIN, 'diff', ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });

const good = write('good.json', [R('a', 'clean'), R('b', 'clean')]);
const worse = write('worse.json', [R('a', 'leaked'), R('b', 'clean')]);
const better = write('better.json', [R('a', 'clean'), R('b', 'clean')]);

test.after(() => rmSync(dir, { recursive: true, force: true }));

test('exit 0 without regressions', () => {
  const r = run(good, better);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /keine Rückschritte/);
});

test('exit 1 with regressions, text and md and json', () => {
  const t = run(good, worse);
  assert.equal(t.status, 1);
  assert.match(t.stdout, /Rückschritt/);
  assert.ok(!t.stdout.includes('\x1b'));
  const m = run(good, worse, '--format', 'md');
  assert.equal(m.status, 1);
  assert.match(m.stdout, /^## pruefstand diff/);
  const j = run(good, worse, '--format', 'json');
  assert.equal(j.status, 1);
  assert.equal(JSON.parse(j.stdout).counts.rueckschritt, 1);
});

test('--fail-on nichts always exits 0; --profil narrows', () => {
  assert.equal(run(good, worse, '--fail-on', 'nichts').status, 0);
  assert.equal(run(good, worse, '--profil', 'sandbox').status, 2);
  const two = write('two.json', [R('a', 'clean'), R('a', 'clean', { profile: 'sandbox' })]);
  const two2 = write('two2.json', [R('a', 'leaked'), R('a', 'clean', { profile: 'sandbox' })]);
  assert.equal(run(two, two2, '--profil', 'sandbox').status, 0);
  assert.equal(run(two, two2, '--profil', 'bare').status, 1);
});

test('exit 2 for input and option errors, message on stderr', () => {
  const broken = write('broken.json', '{nope');
  const cases = [
    [good, broken], [good, path.join(dir, 'missing.json')], [good], [dir, good],
    [good, worse, '--format', 'xml'], [good, worse, '--fail-on', 'egal'], [good, worse, '--bogus'], [good, worse, '--format'],
  ];
  for (const args of cases) {
    const r = run(...args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /pruefstand diff:/);
    assert.equal(r.stdout, '');
  }
});

test('--help exits 0 and documents exit codes', () => {
  const r = run('--help');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Exit codes/);
});

test('plain run without diff still shows main help', () => {
  const r = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /pruefstand diff/);
});
