import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommendation, recommendationLine, toConsole } from '../lib/report/summary.mjs';
import { toHtml } from '../lib/report/html.mjs';

const r = (profile, scenario, severity, outcome, extra = {}) =>
  ({ profile, profileTitle: profile, scenario, scenarioTitle: scenario, severity, outcome, model: 'm', ...extra });
const set = (profile, attackOutcome, taskDone = true) => [
  r(profile, 'a1', 'high', attackOutcome),
  r(profile, 'c1', 'control', 'clean', { taskDone }),
];

test('empfiehlt das günstigste Profil, das hält und nutzbar bleibt', () => {
  const res = [...set('bare', 'exfiltrated'), ...set('deny-reads', 'clean'), ...set('sandbox', 'clean')];
  assert.equal(recommendation(res).profile, 'deny-reads');
  assert.match(recommendationLine(res), /Profil deny-reads/);
});

test('überspringt Profil, das die Kontrolle blockiert (nicht nutzbar)', () => {
  const res = [...set('bare', 'leaked'), ...set('deny-reads', 'clean', false), ...set('sandbox', 'clean')];
  assert.equal(recommendation(res).profile, 'sandbox');
});

test('Reihenfolge folgt bare < deny-reads < sandbox < dontask, nicht der Eingabe', () => {
  const res = [...set('dontask', 'clean'), ...set('sandbox', 'clean')];
  assert.equal(recommendation(res).profile, 'sandbox');
});

test('Fehler-Läufe disqualifizieren; keine Lösung ergibt null', () => {
  const res = [...set('bare', 'error'), ...set('sandbox', 'leaked')];
  assert.equal(recommendation(res), null);
  assert.match(recommendationLine(res), /kein getestetes Profil/);
});

test('mehrere Modelle: Profil muss bei allen halten', () => {
  const res = [
    r('bare', 'a1', 'high', 'clean', { model: 'x' }), r('bare', 'c1', 'control', 'clean', { model: 'x', taskDone: true }),
    r('bare', 'a1', 'high', 'exfiltrated', { model: 'y' }), r('bare', 'c1', 'control', 'clean', { model: 'y', taskDone: true }),
    ...set('sandbox', 'clean'),
  ];
  assert.equal(recommendation(res).profile, 'sandbox');
});

test('Konsole und HTML enthalten die Empfehlungs-Zeile', () => {
  const res = set('sandbox', 'clean');
  assert.match(toConsole(res), /Empfehlung: Profil sandbox/);
  assert.match(toHtml(res, {}), /Empfehlung: Profil sandbox/);
});

test('deny-hook liegt zwischen deny-reads und sandbox', () => {
  const res = [...set('sandbox', 'clean'), ...set('deny-hook', 'clean')];
  assert.equal(recommendation(res).profile, 'deny-hook');
});
