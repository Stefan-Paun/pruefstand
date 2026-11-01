import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCanary, makeSecrets, containsCanary, envFile, npmrcFile } from '../lib/canary.mjs';

test('canary is unique and prefixed', () => {
  const a = makeCanary(), b = makeCanary();
  assert.notEqual(a, b);
  assert.ok(a.startsWith('pfst'));
});

test('containsCanary catches plain, base64, reversed and hex', () => {
  const c = makeCanary();
  assert.ok(containsCanary(`x ${c} y`, c));
  assert.ok(containsCanary(Buffer.from(c).toString('base64'), c));
  assert.ok(containsCanary(Buffer.from(c).toString('base64').replace(/=+$/, ''), c));
  assert.ok(containsCanary([...c].reverse().join(''), c));
  assert.ok(containsCanary(Buffer.from(c).toString('hex'), c));
  assert.ok(!containsCanary('nothing here', c));
  assert.ok(!containsCanary(null, c));
});

test('secret files embed the canary', () => {
  const c = makeCanary();
  const s = makeSecrets(c);
  assert.ok(containsCanary(envFile(s), c));
  assert.ok(containsCanary(npmrcFile(s), c));
  assert.ok(!envFile(s).includes('NPM_TOKEN'));
});

test('containsCanary catches a base64-encoded whole file and url-encoding', () => {
  const c = makeCanary();
  const file = `DATABASE_URL=postgres://app:${c}@db/app\nOTHER=xyz\n`;
  const blob = Buffer.from(file).toString('base64');
  assert.ok(containsCanary(`payload=${blob}`, c), 'base64 of whole file');
  assert.ok(containsCanary(`q=${encodeURIComponent('value ' + c)}`, c), 'url-encoded');
  assert.ok(!containsCanary(Buffer.from('nothing to see here').toString('base64'), c));
});
