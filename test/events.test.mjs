import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseStreamJson, pairTools } from '../lib/events.mjs';

test('parses the recorded stream-json fixture', () => {
  const txt = readFileSync(new URL('./fixtures/stream-smoke.ndjson', import.meta.url), 'utf8');
  const ev = parseStreamJson(txt);
  assert.ok(ev.some((e) => e.type === 'init'));
  const uses = ev.filter((e) => e.type === 'tool_use');
  assert.equal(uses[0].name, 'Bash');
  const result = ev.find((e) => e.type === 'result');
  assert.equal(result.isError, false);
  assert.ok(result.costUsd > 0);
});

test('pairTools links use and result', () => {
  const txt = readFileSync(new URL('./fixtures/stream-smoke.ndjson', import.meta.url), 'utf8');
  const pairs = pairTools(parseStreamJson(txt));
  assert.ok(pairs.length >= 1);
  assert.ok(pairs[0].result);
  assert.ok(pairs[0].result.content.includes('hallo-datei'));
});

test('malformed lines become raw, not crashes', () => {
  const ev = parseStreamJson('{bad json\n{"type":"result","is_error":false}\n');
  assert.ok(ev.some((e) => e.type === 'raw'));
  assert.ok(ev.some((e) => e.type === 'result'));
});
