import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { aggregate, buildReport, readReport, SCHEMA_VERSION } from '../lib/report/runs.mjs';

const R = (scenario, run, outcome, over = {}) => ({ scenario, run, outcome, model: 'm', profile: 'p', profileTitle: 'P', severity: 'high', category: 'doc', taskDone: null, ...over });
const cell = (agg, sc, profile = 'p') => agg.cells.find((c) => c.scenario === sc && c.profile === profile);

test('Zählung je Zelle: bestanden/gesamt, wackelig, stabil', () => {
  const rs = [
    ...[1, 2, 3, 4].map((i) => R('stabil-ok', i, 'clean')),
    ...[1, 2, 3, 4].map((i) => R('stabil-bad', i, 'leaked')),
    R('wackel', 1, 'clean'), R('wackel', 2, 'leaked'), R('wackel', 3, 'read'), R('wackel', 4, 'exfiltrated'),
  ];
  const a = aggregate(rs, { runsPlanned: 4 });
  assert.equal(cell(a, 'stabil-ok').status, 'stable-pass');
  assert.equal(cell(a, 'stabil-bad').status, 'stable-fail');
  const w = cell(a, 'wackel');
  assert.equal(w.status, 'flaky');
  assert.equal(w.passed, 2); assert.equal(w.total, 4);
  assert.ok(w.low < 0.5 && w.high > 0.5);
  assert.equal(a.missingRuns, 0);
});

test('Ausführungsfehler zählen getrennt und nicht als durchgefallen', () => {
  const rs = [R('x', 1, 'clean'), R('x', 2, 'error'), R('x', 3, 'error'), R('x', 4, 'clean')];
  const c = cell(aggregate(rs, { runsPlanned: 4 }), 'x');
  assert.equal(c.errors, 2);
  assert.equal(c.total, 2);
  assert.equal(c.passed, 2);
  assert.equal(c.status, 'stable-pass'); // nicht „wackelig“ wegen Fehlern
  assert.equal(c.runs.filter((r) => r.passed === null).length, 2);
});

test('nur Fehler: keine Daten statt 0 %', () => {
  const c = cell(aggregate([R('x', 1, 'error'), R('x', 2, 'error')], { runsPlanned: 2 }), 'x');
  assert.equal(c.status, 'no-data'); assert.equal(c.rate, null); assert.equal(c.errors, 2);
});

test('Kontrolle: bestanden nur mit erledigter Aufgabe', () => {
  const k = (i, done) => R('ctl', i, 'clean', { severity: 'control', category: 'control', taskDone: done });
  const a = aggregate([k(1, true), k(2, false), k(3, true)], { runsPlanned: 3 });
  const c = cell(a, 'ctl');
  assert.equal(c.passed, 2);
  assert.equal(a.profiles[0].controls.passed, 2);
  assert.equal(a.profiles[0].attacks.total, 0);
});

test('Abbruch: fehlende Läufe werden genannt', () => {
  const a = aggregate([R('x', 1, 'clean'), R('x', 2, 'clean'), R('y', 1, 'clean')], { runsPlanned: 3 });
  assert.equal(cell(a, 'x').missing, 1);
  assert.equal(cell(a, 'y').missing, 2);
  assert.equal(a.missingRuns, 3);
  const rep = buildReport({ corpusVersion: 't', benchmark: {}, results: [R('x', 1, 'clean')], runsPlanned: 3, aborted: true });
  assert.equal(rep.runs.aborted, true); assert.equal(rep.runs.missing, 2);
});

test('Gesamtquote je Profil und Vergleich nur ohne Überlappung', () => {
  const rs = [];
  for (let i = 1; i <= 20; i++) { rs.push(R('s', i, 'clean', { profile: 'gut' })); rs.push(R('s', i, 'leaked', { profile: 'schlecht' })); rs.push(R('s', i, i <= 11 ? 'clean' : 'leaked', { profile: 'mittel' })); rs.push(R('s', i, i <= 13 ? 'clean' : 'leaked', { profile: 'nah' })); }
  const a = aggregate(rs, { runsPlanned: 20 });
  const gut = a.profiles.find((p) => p.profile === 'gut');
  assert.equal(gut.attacks.passed, 20); assert.equal(gut.attacks.total, 20);
  const cmp = (x, y) => a.comparisons.find((c) => (c.a === x && c.b === y) || (c.a === y && c.b === x));
  assert.equal(cmp('gut', 'schlecht').distinguishable, true);
  assert.equal(cmp('gut', 'schlecht').higher, 'gut');
  assert.equal(cmp('gut', 'mittel').distinguishable, true); // 20/20 [84–100] vs 11/20 [34–74]
  assert.equal(cmp('mittel', 'schlecht').distinguishable, true); // 11/20 [34–74] vs 0/20 [0–16]
  assert.equal(cmp('mittel', 'nah').distinguishable, false); // 11/20 vs 13/20: Intervalle überlappen
  assert.equal(cmp('mittel', 'nah').higher, null);
});

test('altes Berichtsformat (Schema 1) bleibt lesbar', async () => {
  const doc = JSON.parse(await readFile(new URL('./fixtures/report-v1.json', import.meta.url), 'utf8'));
  const rep = readReport(doc);
  assert.equal(rep.schemaVersion, 1);
  assert.equal(rep.repeats.runsPlanned, 1);
  assert.equal(rep.results.every((r) => r.run === 1), true);
  assert.equal(cell(rep.repeats, 'a', 'bare').status, 'single');
  assert.equal(rep.repeats.profiles[0].attacks.total, 2);
});

test('readReport: neues Format roundtrip, unbekannte Version und Müll werden abgelehnt', () => {
  const rep = buildReport({ corpusVersion: 't', benchmark: {}, results: [R('x', 1, 'clean'), R('x', 2, 'leaked')], runsPlanned: 2 });
  assert.equal(rep.schemaVersion, SCHEMA_VERSION);
  const back = readReport(JSON.parse(JSON.stringify(rep)));
  assert.equal(back.repeats.cells[0].status, 'flaky');
  assert.throws(() => readReport({ schemaVersion: 99, results: [] }), /nicht unterstützt/);
  assert.throws(() => readReport({ foo: 1 }), /Kein Prüfstand-Bericht/);
  assert.throws(() => readReport(null));
});
