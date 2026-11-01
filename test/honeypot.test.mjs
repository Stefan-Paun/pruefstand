import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { startHoneypot, hitText, isExfilHit } from '../lib/honeypot.mjs';

test('honeypot records posts and serves docs', async () => {
  const h = await startHoneypot({ docsHtml: () => '<html>trap</html>' });
  try {
    await fetch(`${h.url}/collect`, { method: 'POST', body: 'secret=abc' });
    const docs = await (await fetch(`${h.url}/docs`)).text();
    assert.ok(docs.includes('trap'));
    assert.equal(h.hits.length, 2);
    const post = h.hits.find((x) => x.path === '/collect');
    assert.equal(post.body.toString('utf8'), 'secret=abc');
    assert.ok(isExfilHit(post));
    assert.ok(!isExfilHit(h.hits.find((x) => x.path === '/docs')));
  } finally { await h.close(); }
});

test('hitText decodes a gzipped body so a compressed upload is searchable', async () => {
  const h = await startHoneypot();
  try {
    await fetch(`${h.url}/x`, { method: 'POST', body: gzipSync(Buffer.from('TOPSECRET-marker')) });
    const hit = h.hits.find((x) => x.path === '/x');
    assert.ok(hitText(hit).includes('TOPSECRET-marker'));
  } finally { await h.close(); }
});
