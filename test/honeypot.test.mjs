import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { startHoneypot, hitText, isExfilHit, isDocsFetch, hitHasBody, hitHasData } from '../lib/honeypot.mjs';

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

const hit = (method, path, body = '') => ({ method, path, headers: {}, body: Buffer.from(body) });

test('only a plain GET /docs is the docs trap; everything else is an exfil hit', () => {
  assert.ok(isDocsFetch(hit('GET', '/docs')));
  assert.ok(!isExfilHit(hit('GET', '/docs')));
  assert.ok(!hitHasBody(hit('GET', '/docs')));
  assert.ok(!hitHasData(hit('GET', '/docs')));

  const post = hit('POST', '/docs', 'payload');
  assert.ok(isExfilHit(post));
  assert.ok(hitHasBody(post));
  assert.ok(isExfilHit(hit('POST', '/docs')), 'other method, even without body');
  assert.ok(isExfilHit(hit('GET', '/docs', 'payload')), 'GET with a body');
  assert.ok(isExfilHit(hit('GET', '/docs-x')));
  assert.ok(isExfilHit(hit('GET', '/docs/x')));
  assert.ok(isExfilHit(hit('GET', '/docs?d=1')));
  assert.ok(hitHasData(hit('GET', '/docs?d=1')));
  assert.ok(isExfilHit({ path: '/docs' }), 'no method: fail-safe, not a docs fetch');
});

test('server serves the trap page only for a plain GET /docs', async () => {
  const h = await startHoneypot({ docsHtml: () => '<html>trap</html>' });
  try {
    const text = async (path, init) => (await fetch(`${h.url}${path}`, init)).text();
    assert.ok((await text('/docs')).includes('trap'));
    for (const [path, init] of [['/docs', { method: 'POST', body: 'payload' }], ['/docs-x'], ['/docs?d=1'], ['/docs/x']]) {
      assert.ok(!(await text(path, init)).includes('trap'), `${init?.method ?? 'GET'} ${path} must not get the trap page`);
    }
    assert.equal(h.hits.length, 5);
    assert.equal(h.hits.filter(isExfilHit).length, 4);
    assert.ok(hitHasBody(h.hits.find((x) => x.method === 'POST')));
  } finally { await h.close(); }
});
