import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReport, compareReports, isBeyondNoise, DiffInputError } from '../lib/report/diff.mjs';
import { toText, toMarkdownDiff, toJson, mdEscape } from '../lib/report/diff-format.mjs';

// Invented reports: no agent, no files.
const R = (scenario, outcome, over = {}) => ({ scenario, profile: 'bare', model: 'm1', severity: 'high', outcome, taskDone: null, ...over });
const rep = (results, over = {}) => JSON.stringify({ corpusVersion: 'v1', results, ...over });
const cmp = (a, b, opt) => compareReports(parseReport(rep(a), 'alt'), parseReport(rep(b), 'neu'), opt);
const cat = (d, s) => d.entries.find((e) => e.scenario === s).category;

test('all five categories', () => {
  const d = cmp(
    [R('reg', 'clean'), R('imp', 'leaked'), R('same', 'clean'), R('gone', 'clean')],
    [R('reg', 'leaked'), R('imp', 'clean'), R('same', 'read'), R('fresh', 'clean')],
  );
  assert.equal(cat(d, 'reg'), 'rueckschritt');
  assert.equal(cat(d, 'imp'), 'verbesserung');
  assert.equal(cat(d, 'same'), 'unveraendert');
  assert.deepEqual(d.added.map((x) => x.scenario), ['fresh']);
  assert.deepEqual(d.dropped.map((x) => x.scenario), ['gone']);
  assert.deepEqual(d.counts, { rueckschritt: 1, verbesserung: 1, unveraendert: 1, neu: 1, entfallen: 1, unbewertet: 0 });
  assert.equal(d.hasRegressions, true);
});

test('worse outcome that was already a breach is unchanged; control needs taskDone', () => {
  const d = cmp(
    [R('x', 'leaked'), R('ctl', 'clean', { severity: 'control', taskDone: true })],
    [R('x', 'exfiltrated'), R('ctl', 'clean', { severity: 'control', taskDone: false })],
  );
  assert.equal(cat(d, 'x'), 'unveraendert');
  assert.equal(cat(d, 'ctl'), 'rueckschritt');
});

test('profile summary: rates before/after and difference over common cells', () => {
  const d = cmp([R('a', 'clean'), R('b', 'clean'), R('c', 'leaked'), R('d', 'clean')], [R('a', 'clean'), R('b', 'leaked'), R('c', 'leaked'), R('d', 'leaked')]);
  const s = d.summary[0];
  assert.equal(s.profile, 'bare');
  assert.equal(s.attacks.before.quote, 0.75);
  assert.equal(s.attacks.after.quote, 0.25);
  assert.equal(s.attacks.diff, -0.5);
  assert.equal(s.regressions, 2);
});

test('single runs warn that a difference may be chance', () => {
  const d = cmp([R('a', 'clean')], [R('a', 'leaked')]);
  assert.ok(d.warnings.some((w) => w.code === 'single-run'));
});

test('multiple runs: change within noise is not a regression', () => {
  const runs = (n, heldN) => Array.from({ length: n }, (_, i) => R('a', i < heldN ? 'clean' : 'leaked'));
  assert.equal(isBeyondNoise({ held: 3, total: 3 }, { held: 2, total: 3 }), false);
  const small = cmp(runs(3, 3), runs(3, 2));
  assert.equal(cat(small, 'a'), 'unveraendert');
  assert.equal(small.entries[0].withinNoise, true);
  assert.equal(small.hasRegressions, false);
  assert.ok(!small.warnings.some((w) => w.code === 'single-run'));
  const big = cmp(runs(5, 5), runs(5, 1));
  assert.equal(cat(big, 'a'), 'rueckschritt');
  assert.deepEqual(big.entries[0].before, { held: 5, runs: 5 });
  assert.equal(cmp(runs(5, 1), runs(5, 5)).entries[0].category, 'verbesserung');
});

test('error runs are ignored; cells with only errors are not rated', () => {
  const d = cmp([R('a', 'clean'), R('b', 'clean')], [R('a', 'clean'), R('a', 'error'), R('b', 'error')]);
  assert.equal(cat(d, 'a'), 'unveraendert');
  assert.deepEqual(d.unscored.map((x) => x.scenario), ['b']);
  assert.ok(d.warnings.some((w) => w.code === 'errors'));
});

test('different corpus version, scenario set, schema and model are reported', () => {
  const a = parseReport(rep([R('a', 'clean'), R('only-old', 'clean')], { corpusVersion: 'v1', schema: 1 }), 'alt');
  const b = parseReport(rep([R('a', 'clean', { model: 'm2' }), R('only-new', 'clean')], { corpusVersion: 'v2', schema: 2 }), 'neu');
  const d = compareReports(a, b);
  const codes = d.warnings.map((w) => w.code);
  for (const c of ['corpus-version', 'schema', 'scenario-set', 'model']) assert.ok(codes.includes(c), c);
  assert.equal(d.entries.length, 1); // intersection only
  assert.equal(d.summary[0].attacks.before.total, 1);
});

test('corpus version falls back to benchmark.corpusVersion', () => {
  const r = parseReport(JSON.stringify({ benchmark: { corpusVersion: 'v9' }, results: [] }), 'x');
  assert.equal(r.corpusVersion, 'v9');
});

test('--profil filters; unknown profile is an input error', () => {
  const a = [R('a', 'clean'), R('a', 'clean', { profile: 'sandbox' })];
  const b = [R('a', 'leaked'), R('a', 'clean', { profile: 'sandbox' })];
  const d = cmp(a, b, { profile: 'sandbox' });
  assert.equal(d.entries.length, 1);
  assert.equal(d.hasRegressions, false);
  assert.throws(() => cmp(a, b, { profile: 'nope' }), DiffInputError);
});

test('broken input is rejected with a clear error', () => {
  const bad = [
    ['not json', '{oops'],
    ['array top level', '[]'],
    ['no results', '{}'],
    ['results not array', '{"results":{}}'],
    ['entry not object', '{"results":[1]}'],
    ['scenario type', rep([R(5, 'clean')])],
    ['empty profile', rep([R('a', 'clean', { profile: '' })])],
    ['unknown outcome', rep([R('a', 'banana')])],
    ['taskDone type', rep([R('a', 'clean', { taskDone: 'yes' })])],
    ['model type', rep([R('a', 'clean', { model: {} })])],
    ['corpusVersion type', rep([], { corpusVersion: {} })],
    ['id too long', rep([R('x'.repeat(201), 'clean')])],
  ];
  for (const [name, text] of bad) assert.throws(() => parseReport(text, 'f.json'), (e) => e instanceof DiffInputError && e.message.startsWith('f.json:'), name);
  assert.throws(() => parseReport('x'.repeat(21 * 1024 * 1024), 'big'), /too large/);
});

test('markdown escapes pipes, backticks, newlines and mentions', () => {
  const nasty = 'a|b`c\nd @bob <img> [x](y)';
  const e = mdEscape(nasty);
  assert.ok(!e.includes('\n'));
  assert.ok(!/(^|[^\\])\|/.test(e));
  assert.ok(!/(^|[^\\])`/.test(e));
  assert.ok(!e.includes('@') && !e.includes('<'));
  const d = cmp([R(nasty, 'clean')], [R(nasty, 'leaked')]);
  const md = toMarkdownDiff(d);
  const row = md.split('\n').find((l) => l.startsWith('| Rückschritt'));
  assert.equal(row.split(/(?<!\\)\|/).length, 7); // 5 columns -> table not broken
});

test('text output: no colour by default, colour on request, control characters stripped', () => {
  const d = cmp([R('a\x1b[31mX', 'clean')], [R('a\x1b[31mX', 'leaked')]);
  assert.ok(!toText(d).includes('\x1b'));
  const c = toText(d, { color: true });
  assert.ok(c.includes('\x1b[31m') && !c.includes('a\x1b[31mX'));
  assert.match(toText(d), /Rückschritte gefunden/);
});

test('json output is parseable and carries the verdict', () => {
  const d = cmp([R('a', 'clean')], [R('a', 'leaked')]);
  const j = JSON.parse(toJson(d));
  assert.equal(j.hasRegressions, true);
  assert.equal(j.counts.rueckschritt, 1);
});

test('unusable: no rated cell in both reports (empty, disjoint, or only errors)', () => {
  assert.equal(cmp([R('a', 'clean')], [R('a', 'clean')]).unusable, false);
  assert.equal(cmp([R('a', 'clean')], [R('b', 'clean')]).unusable, true);
  assert.equal(cmp([R('a', 'clean')], [R('a', 'error')]).unusable, true);
  assert.equal(cmp([R('a', 'clean'), R('b', 'clean')], [R('a', 'error'), R('b', 'clean')]).unusable, false);
});
