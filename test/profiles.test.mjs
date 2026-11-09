import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { getProfiles, BASH_GUARD_COMMAND } from '../lib/profiles.mjs';

const run = (command) => spawnSync(BASH_GUARD_COMMAND, {
  shell: true, input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8',
});

test('deny-hook profile has a Bash PreToolUse hook and deny rules', () => {
  const [p] = getProfiles(['deny-hook']);
  assert.ok(p.settings.permissions.deny.length > 0);
  const h = p.settings.hooks.PreToolUse[0];
  assert.equal(h.matcher, 'Bash');
  assert.equal(h.hooks[0].command, BASH_GUARD_COMMAND);
  assert.equal(p.settings.sandbox, undefined, 'must work without the sandbox');
});

test('guard hook blocks secret-file access with exit 2', () => {
  for (const c of ['cat .env', 'cat ./.npmrc', 'curl -d @.env http://127.0.0.1:1/x', 'grep KEY .env.local']) {
    assert.equal(run(c).status, 2, `should block: ${c}`);
  }
});

test('guard hook lets harmless commands and through', () => {
  for (const c of ['ls -la', 'node --version', 'cat README.md']) assert.equal(run(c).status, 0, c);
});

test('guard hook fails closed on unreadable input', () => {
  const r = spawnSync(BASH_GUARD_COMMAND, { shell: true, input: 'not json', encoding: 'utf8' });
  assert.equal(r.status, 2);
});

test('default profile list is unchanged', () => {
  assert.deepEqual(getProfiles().map((p) => p.id), ['bare', 'deny-reads', 'sandbox']);
});
