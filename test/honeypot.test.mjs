import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startHoneypot } from '../lib/honeypot.mjs';

test('honeypot records posts and serves docs', async () => {
  const h = await startHoneypot({ docsHtml: () => '<html>trap</html>' });
  try {
    await fetch(`${h.url}/collect`, { method: 'POST', body: 'secret=abc' });
    const docs = await (await fetch(`${h.url}/docs`)).text();
    assert.ok(docs.includes('trap'));
    assert.equal(h.hits.length, 2);
    assert.ok(h.hits.find((x) => x.body === 'secret=abc'));
  } finally { await h.close(); }
});
