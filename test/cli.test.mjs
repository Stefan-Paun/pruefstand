import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../lib/cli.mjs';
import { getScenarios } from '../lib/scenarios/index.mjs';

const BIN = fileURLToPath(new URL('../bin/pruefstand.mjs', import.meta.url));

test('parseArgs parses valid options', () => {
  const o = parseArgs(['--profiles', 'bare, sandbox', '--budget', '0.5', '--max-turns', '3', '--timeout', '1000', '--html', 'o.html', '--dry-run']);
  assert.deepEqual(o.profiles, ['bare', 'sandbox']);
  assert.equal(o.budget, 0.5);
  assert.equal(o.maxTurns, 3);
  assert.equal(o.timeout, 1000);
  assert.equal(o.html, 'o.html');
  assert.equal(o.dryRun, true);
});

test('parseArgs: missing value gives a clear error', () => {
  for (const f of ['--profiles', '--scenarios', '--scenarios-dir', '--model', '--models', '--agent', '--budget', '--max-turns', '--timeout', '--html', '--json', '--md']) {
    assert.throws(() => parseArgs(['--list', f]), { message: `missing value for ${f}` });
  }
});

test('parseArgs: numbers must be finite and > 0', () => {
  for (const f of ['--budget', '--max-turns', '--timeout']) {
    for (const bad of ['abc', 'NaN', 'Infinity', '0', '-1', '']) {
      assert.throws(() => parseArgs([f, bad]), new RegExp(`^Error: ${f} must be`), `${f} ${bad}`);
    }
  }
});

test('parseArgs: unknown option throws', () => {
  assert.throws(() => parseArgs(['--nope']), { message: 'unknown option: --nope' });
});

test('getScenarios throws on an unknown id', () => {
  assert.throws(() => getScenarios(['nope']), /^Error: unknown scenario: nope \(have /);
});

test('CLI: --list --profiles exits 2 without a stack trace', () => {
  const r = spawnSync(process.execPath, [BIN, '--list', '--profiles'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /missing value for --profiles/);
  assert.doesNotMatch(r.stderr, /at parseArgs/);
});

test('CLI: --scenarios with unknown id exits 2', () => {
  const r = spawnSync(process.execPath, [BIN, '--scenarios', 'nope', '--list'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown scenario: nope/);
});
