import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, repeatsMarkdown } from '../lib/report/runs.mjs';
import { benchmark, toMarkdown } from '../lib/report/benchmark.mjs';
import { toHtml } from '../lib/report/html.mjs';

const R = (scenario, run, outcome, over = {}) => ({ scenario, scenarioTitle: scenario, run, outcome, model: 'm', profile: 'p', profileTitle: 'P', severity: 'high', category: 'doc', taskDone: null, costUsd: 0, ...over });
const many = [1, 2, 3, 4, 5].flatMap((i) => [R('fest', i, 'clean'), R('wackel', i, i % 2 ? 'clean' : 'leaked'), R('kaputt', i, i === 5 ? 'error' : 'leaked')]);

test('Markdown: Quote ± Bereich, wackelige Zelle markiert, Fehler getrennt', () => {
  const agg = aggregate(many, { runsPlanned: 5 });
  const md = toMarkdown(benchmark(many, { corpusVersion: 't' }), agg);
  assert.ok(md.includes('## Repeated runs'));
  assert.ok(md.includes('Flaky cases'));
  assert.ok(/\| wackel \| 3\/5 \|/.test(md)); // Flaky-Tabelle
  assert.ok(/\d+ % \[\d+–\d+ %\]/.test(md));
  assert.ok(md.includes('Execution errors'));
  assert.ok(!md.includes('Single measurement'));
});

test('Markdown bei einem Lauf nennt ausdrücklich die Einzelmessung', () => {
  const one = [R('a', 1, 'clean'), R('b', 1, 'leaked')];
  const md = toMarkdown(benchmark(one, { corpusVersion: 't' }), aggregate(one, { runsPlanned: 1 }));
  assert.ok(md.includes('Single measurement'));
  assert.ok(md.includes('not a rate'));
});

test('Markdown nennt fehlende Läufe nach Abbruch', () => {
  const md = repeatsMarkdown(aggregate([R('a', 1, 'clean')], { runsPlanned: 4 }));
  assert.ok(md.includes('Incomplete'));
  assert.ok(md.includes('3 planned runs are missing'));
});

test('Markdown ohne Wiederholungsdaten bleibt wie bisher', () => {
  const md = toMarkdown(benchmark(many, { corpusVersion: 't' }));
  assert.ok(!md.includes('Repeated runs'));
});

test('Markdown: Pipe und Zeilenumbruch in Titeln zerreißen die Tabelle nicht', () => {
  const rs = [1, 2].flatMap((i) => [R('x', i, i === 1 ? 'clean' : 'leaked', { scenarioTitle: 'a | b\nc' })]);
  const md = repeatsMarkdown(aggregate(rs, { runsPlanned: 2 }));
  const rows = md.split('\n').filter((l) => l.startsWith('| m |'));
  assert.ok(rows.every((l) => !l.includes('\n')));
  assert.ok(md.includes('a \\| b c'));
});

test('benchmark: attacksPerRun zählt Szenarien, nicht Läufe', () => {
  const b = benchmark(many, { corpusVersion: 't' });
  assert.equal(b.attacksPerRun, 3);
  const old = benchmark([R('a', undefined, 'clean'), R('b', undefined, 'clean')], { corpusVersion: 't' });
  assert.equal(old.attacksPerRun, 2);
});

test('HTML: Quote je Zelle, wackelig markiert, Einzelmessung genannt, HTML wird escaped', () => {
  const agg = aggregate(many, { runsPlanned: 5 });
  const html = toHtml(many, { repeats: agg, corpusVersion: 't', model: 'm' });
  assert.ok(html.includes('3/5 ~'));
  assert.ok(html.includes('Wackelige Fälle'));
  assert.ok(html.includes('0/4'));
  assert.ok(html.includes('(1 err)'));
  const one = [R('<b>x</b>', 1, 'clean', { scenarioTitle: '<b>x</b>' })];
  const h1 = toHtml(one, { repeats: aggregate(one, { runsPlanned: 1 }) });
  assert.ok(h1.includes('Einzelmessung'));
  assert.ok(!h1.includes('<b>x</b>'));
});

test('HTML ohne repeats bleibt ohne neuen Abschnitt', () => {
  const html = toHtml([R('a', 1, 'clean')], {});
  assert.ok(!html.includes('Wiederholte Läufe'));
});
