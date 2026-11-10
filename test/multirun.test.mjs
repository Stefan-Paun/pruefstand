import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAll, parseRuns, estimate, needsConfirmation, estimateText, MAX_RUNS } from '../lib/multirun.mjs';
import { aggregate } from '../lib/report/runs.mjs';

const sc = (id, severity = 'high') => ({ id, title: id, severity, category: 'doc' });
const pr = (id) => ({ id, title: id.toUpperCase() });
const scenarios = [sc('a'), sc('b'), sc('c')];
const profiles = [pr('p1'), pr('p2')];

// Attrappen-Agent mit festem Muster: Szenario a besteht immer, b nie, c nur in geraden Läufen,
// Profil p2 wirft in Lauf 3 einen Fehler (Absturz).
const dummy = async ({ scenario, profile, model, run }) => {
  if (profile.id === 'p2' && run === 3) throw new Error('Absturz');
  const ok = scenario.id === 'a' || (scenario.id === 'c' && run % 2 === 0);
  return { scenario: scenario.id, scenarioTitle: scenario.title, severity: scenario.severity, category: scenario.category, profile: profile.id, profileTitle: profile.title, model, outcome: ok ? 'clean' : 'leaked', taskDone: null };
};

test('Attrappen-Agent: Zählung je Zelle nach festem Muster', async () => {
  const out = await runAll({ scenarios, profiles, models: ['m'], runs: 4, runOne: dummy });
  assert.equal(out.planned, 24); assert.equal(out.done, 24); assert.equal(out.aborted, false);
  const agg = aggregate(out.results, { runsPlanned: 4 });
  const c = (s, p) => agg.cells.find((x) => x.scenario === s && x.profile === p);
  assert.equal(c('a', 'p1').status, 'stable-pass');
  assert.equal(c('b', 'p1').status, 'stable-fail');
  assert.equal(c('c', 'p1').status, 'flaky');
  assert.equal(c('c', 'p1').passed, 2);
  // p2: Lauf 3 ist abgestürzt -> Fehler getrennt, nicht durchgefallen
  assert.equal(c('b', 'p2').errors, 1); assert.equal(c('b', 'p2').total, 3); assert.equal(c('b', 'p2').passed, 0);
  assert.equal(c('a', 'p2').status, 'stable-pass');
  assert.equal(c('c', 'p2').passed, 2); // Läufe 2 und 4 bestanden, Lauf 1 durchgefallen, Lauf 3 Fehler
  assert.equal(c('c', 'p2').total, 3);
  assert.equal(agg.missingRuns, 0);
  assert.equal(agg.errorRuns, 3);
});

test('Ergebnisse tragen die Laufnummer', async () => {
  const out = await runAll({ scenarios: [sc('a')], profiles: [pr('p1')], models: ['m'], runs: 3, runOne: dummy });
  assert.deepEqual(out.results.map((r) => r.run), [1, 2, 3]);
});

test('Abbruch mitten im Lauf: bisherige Ergebnisse bleiben, fehlende Läufe werden genannt', async () => {
  let calls = 0;
  const out = await runAll({ scenarios, profiles, models: ['m'], runs: 4, runOne: dummy, shouldStop: () => calls >= 8, onDone: () => { calls++; } });
  assert.equal(out.aborted, true);
  assert.equal(out.results.length, 8);
  const agg = aggregate(out.results, { runsPlanned: 4 });
  // 8 Fälle von 6 je Runde: Runde 1 komplett, Runde 2 mit 2 Fällen
  assert.equal(agg.missingRuns, 24 - 8);
  assert.equal(agg.cells.find((x) => x.scenario === 'a' && x.profile === 'p1').missing, 2);
  assert.equal(agg.cells.find((x) => x.scenario === 'c' && x.profile === 'p2').missing, 3);
});

test('Abbruch vor dem ersten Fall: keine Ergebnisse, kein Agentenaufruf', async () => {
  let called = 0;
  const out = await runAll({ scenarios, profiles, models: ['m'], runs: 2, runOne: async () => { called++; return {}; }, shouldStop: () => true });
  assert.equal(called, 0); assert.equal(out.results.length, 0); assert.equal(out.aborted, true);
});

test('dryRun-Ergebnisse werden nicht gesammelt', async () => {
  const out = await runAll({ scenarios, profiles, models: ['m'], runs: 1, runOne: async () => ({ dryRun: true }) });
  assert.equal(out.results.length, 0); assert.equal(out.done, 6);
});

test('parseRuns: Grenzen und Müll', () => {
  assert.equal(parseRuns('1'), 1); assert.equal(parseRuns(String(MAX_RUNS)), MAX_RUNS);
  for (const bad of ['0', '-1', String(MAX_RUNS + 1), '2.5', 'abc', '', undefined, 'NaN', '1e1']) assert.throws(() => parseRuns(bad), RangeError, String(bad));
});

test('Aufwand und Nachfrage-Schwelle', () => {
  const e = estimate({ scenarios: 12, profiles: 3, models: 1, runs: 5, budgetUsd: 0.1, timeoutMs: 150000 });
  assert.equal(e.perRun, 36); assert.equal(e.total, 180);
  assert.ok(Math.abs(e.maxBudgetUsd - 18) < 1e-9); assert.equal(e.maxMinutes, 450);
  assert.ok(estimateText(e, { runs: 5 }).includes('36 Fälle × 5 Läufe = 180 Agentenläufe'));
  assert.equal(needsConfirmation({ total: 180, runs: 5 }), true);
  assert.equal(needsConfirmation({ total: 180, runs: 5, yes: true }), false);
  assert.equal(needsConfirmation({ total: 180, runs: 5, dryRun: true }), false);
  assert.equal(needsConfirmation({ total: 36, runs: 1 }), false);
  assert.equal(needsConfirmation({ total: 108, runs: 1 }), false); // --runs 1 verhält sich wie bisher
  assert.equal(needsConfirmation({ total: 40, runs: 2 }), false);
  assert.equal(needsConfirmation({ total: 72, runs: 2 }), true);
});
