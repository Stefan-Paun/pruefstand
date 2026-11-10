import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wilson, rate, classify, compare, formatRate, STATUS } from '../lib/stats.mjs';

const near = (a, b, eps = 0.002) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('Wilson gegen bekannte Werte (95 %)', () => {
  let w = wilson(5, 10); near(w.low, 0.2366); near(w.high, 0.7634);
  w = wilson(0, 10); near(w.low, 0); near(w.high, 0.2775);
  w = wilson(10, 10); near(w.low, 0.7225); near(w.high, 1);
  w = wilson(8, 10); near(w.low, 0.4902); near(w.high, 0.9433);
  w = wilson(1, 1); near(w.low, 0.2065); near(w.high, 1);
});

test('Wilson: n = 0 gibt null, ungültige Eingaben werfen', () => {
  assert.equal(wilson(0, 0), null);
  assert.throws(() => wilson(3, 2), RangeError);
  assert.throws(() => wilson(-1, 2), RangeError);
  assert.throws(() => wilson(1.5, 2), RangeError);
});

test('Wilson bleibt in [0,1] und enthält die Quote', () => {
  for (let n = 1; n <= 20; n++) for (let k = 0; k <= n; k++) {
    const w = wilson(k, n);
    assert.ok(w.low >= 0 && w.high <= 1 && w.low <= k / n + 1e-9 && w.high >= k / n - 1e-9);
  }
});

test('Einstufung: stabil bestanden / stabil durchgefallen / wackelig / Einzelmessung', () => {
  assert.equal(classify(5, 5), STATUS.STABLE_PASS);
  assert.equal(classify(0, 5), STATUS.STABLE_FAIL);
  assert.equal(classify(3, 5), STATUS.FLAKY);
  assert.equal(classify(1, 5), STATUS.FLAKY);
  assert.equal(classify(1, 1), STATUS.SINGLE);
  assert.equal(classify(0, 1), STATUS.SINGLE);
  assert.equal(classify(0, 0), STATUS.NO_DATA);
});

test('Vergleich: unterscheidbar nur ohne Überlappung', () => {
  const hoch = rate(20, 20), tief = rate(0, 20);
  assert.deepEqual(compare(hoch, tief), { distinguishable: true, higher: 'a' });
  assert.deepEqual(compare(tief, hoch), { distinguishable: true, higher: 'b' });
  // 8/10 vs 5/10 überlappen -> nicht unterscheidbar, obwohl 80 % > 50 %
  assert.equal(compare(rate(8, 10), rate(5, 10)).distinguishable, false);
  assert.equal(compare(rate(10, 10), rate(0, 0)).distinguishable, false);
  assert.equal(compare(rate(1, 1), rate(0, 1)).distinguishable, false); // Einzelmessungen
});

test('formatRate', () => {
  assert.equal(formatRate(rate(5, 10)), '50 % [24–76 %]');
  assert.equal(formatRate(rate(0, 0)), '—');
});
