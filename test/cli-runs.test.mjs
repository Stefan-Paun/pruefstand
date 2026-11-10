import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readReport } from '../lib/report/runs.mjs';

const BIN = fileURLToPath(new URL('../bin/pruefstand.mjs', import.meta.url));
const SMOKE = fileURLToPath(new URL('./fixtures/stream-smoke.ndjson', import.meta.url));
const run = (args, opts = {}) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, ...opts });

// Attrappen-Agent: ungerade Aufrufe liefern ein gültiges Ergebnis (aus dem Fixture),
// gerade Aufrufe liefern nichts (= Ausführungsfehler). Zählt über eine Datei.
async function fakeAgent(dir, { sleepMs = 0 } = {}) {
  const file = path.join(dir, 'agent.mjs');
  const counter = path.join(dir, 'count');
  await writeFile(file, `#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const c = existsSync(${JSON.stringify(counter)}) ? Number(readFileSync(${JSON.stringify(counter)}, 'utf8')) : 0;
writeFileSync(${JSON.stringify(counter)}, String(c + 1));
setTimeout(() => { if (c % 2 === 0) process.stdout.write(readFileSync(${JSON.stringify(SMOKE)}, 'utf8')); }, ${sleepMs});
`);
  await chmod(file, 0o755);
  return file;
}

test('--runs: ungültige Werte werden abgelehnt (Exit 2)', () => {
  for (const bad of ['0', '21', 'x', '2.5']) {
    const r = run(['--runs', bad, '--dry-run']);
    assert.equal(r.status, 2, `--runs ${bad}`);
    assert.ok(r.stderr.includes('--runs'));
  }
});

test('--dry-run zeigt den Aufwand, ruft keinen Agenten und fragt nicht nach', () => {
  const r = run(['--dry-run', '--runs', '20', '--agent', '/nonexistent/agent']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('Aufwand:'));
  assert.ok(/= 720 Agentenläufe/.test(r.stdout));
  assert.ok(r.stdout.includes('planned'));
});

test('großer Stapel ohne Terminal und ohne --ja: Abbruch vor dem Agenten', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pruefstand-t-'));
  try {
    const agent = await fakeAgent(dir);
    const r = run(['--runs', '5', '--agent', agent]); // 12×3×5 = 180 > Schwelle
    assert.equal(r.status, 2);
    assert.ok(r.stderr.includes('--ja'));
    await assert.rejects(readFile(path.join(dir, 'count')), 'Agent darf nicht aufgerufen worden sein');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Läufe mit Attrappen-Agent: Fehler getrennt, Schema 2, Markdown/HTML-Abschnitt', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pruefstand-t-'));
  try {
    const agent = await fakeAgent(dir);
    const json = path.join(dir, 'b.json'), md = path.join(dir, 'b.md'), html = path.join(dir, 'b.html');
    const r = run(['--runs', '4', '--scenarios', 'direct-read', '--profiles', 'bare', '--agent', agent, '--json', json, '--md', md, '--html', html]);
    const rep = readReport(JSON.parse(await readFile(json, 'utf8')));
    assert.equal(rep.schemaVersion, 2, r.stdout + r.stderr);
    assert.equal(rep.results.length, 4);
    assert.deepEqual(rep.results.map((x) => x.run), [1, 2, 3, 4]);
    const cell = rep.repeats.cells[0];
    assert.equal(cell.errors, 2);           // gerade Aufrufe: kein Ergebnis -> Fehler
    assert.equal(cell.total, 2);            // nur die zwei echten Läufe gehen in die Quote
    assert.equal(rep.repeats.missingRuns, 0);
    assert.ok((await readFile(md, 'utf8')).includes('## Repeated runs'));
    assert.ok((await readFile(html, 'utf8')).includes('Wiederholte Läufe'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Standard (ein Lauf): Bericht nennt die Einzelmessung', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pruefstand-t-'));
  try {
    const agent = await fakeAgent(dir);
    const md = path.join(dir, 'b.md'), json = path.join(dir, 'b.json');
    run(['--scenarios', 'direct-read', '--profiles', 'bare', '--agent', agent, '--md', md, '--json', json]);
    assert.ok((await readFile(md, 'utf8')).includes('Single measurement'));
    assert.equal(JSON.parse(await readFile(json, 'utf8')).runs.planned, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Strg-C mitten im Stapel: bisherige Ergebnisse werden geschrieben, fehlende Läufe genannt', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pruefstand-t-'));
  try {
    const agent = await fakeAgent(dir, { sleepMs: 600 });
    const json = path.join(dir, 'b.json'), md = path.join(dir, 'b.md');
    const child = spawn(process.execPath, [BIN, '--runs', '6', '--scenarios', 'direct-read', '--profiles', 'bare', '--agent', agent, '--json', json, '--md', md], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', sent = false;
    child.stdout.on('data', (c) => { out += c; if (!sent && out.includes('[1/6]')) { sent = true; setTimeout(() => child.kill('SIGINT'), 100); } });
    const code = await new Promise((res) => child.on('close', res));
    const rep = JSON.parse(await readFile(json, 'utf8'));
    assert.equal(code, 130, out);
    assert.equal(rep.runs.aborted, true);
    assert.ok(rep.results.length >= 1 && rep.results.length < 6);
    assert.equal(rep.runs.missing, 6 - rep.results.length);
    assert.ok((await readFile(md, 'utf8')).includes('Incomplete'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
