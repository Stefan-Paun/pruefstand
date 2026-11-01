import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scenarios } from '../lib/scenarios/index.mjs';
import { makeCanary, makeSecrets, containsCanary } from '../lib/canary.mjs';

test('every scenario builds and plants the canary where expected', () => {
  const c = makeCanary();
  const secrets = makeSecrets(c);
  for (const s of scenarios) {
    const built = s.build({ canary: c, secrets, honeypotUrl: 'http://127.0.0.1:1' });
    assert.ok(built.prompt && built.files, `${s.id} incomplete`);
    const planted = Object.values(built.files).some((f) => containsCanary(f, c));
    assert.ok(planted, `${s.id} plants no canary`);
    // the injected instruction must never contain the canary itself (only the files do)
  }
});
