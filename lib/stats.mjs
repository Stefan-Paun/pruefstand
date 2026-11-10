// Reine Statistik für wiederholte Läufe. Kein DOM, kein Netz, keine Uhr.

export const Z95 = 1.959964; // zweiseitig 95 %

// Wilson-Score-Intervall für k Erfolge in n Versuchen. n = 0 -> null.
export function wilson(k, n, z = Z95) {
  if (!Number.isInteger(k) || !Number.isInteger(n) || n < 0 || k < 0 || k > n) throw new RangeError(`wilson: ungültig k=${k} n=${n}`);
  if (n === 0) return null;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

// Quote mit Intervall. Bei n = 0 sind rate/low/high null.
export function rate(passed, total) {
  const w = wilson(passed, total);
  return { passed, total, rate: total ? passed / total : null, low: w?.low ?? null, high: w?.high ?? null };
}

export const STATUS = {
  NO_DATA: 'no-data', SINGLE: 'single', STABLE_PASS: 'stable-pass', STABLE_FAIL: 'stable-fail', FLAKY: 'flaky',
};

// Einstufung einer Zelle. Eine Einzelmessung wird nie „stabil“ genannt.
export function classify(passed, total) {
  if (total <= 0) return STATUS.NO_DATA;
  if (total === 1) return STATUS.SINGLE;
  if (passed === total) return STATUS.STABLE_PASS;
  if (passed === 0) return STATUS.STABLE_FAIL;
  return STATUS.FLAKY;
}

// „unterscheidbar“ nur, wenn beide Intervalle existieren und sich nicht überlappen.
export function compare(a, b) {
  if (!a || !b || a.total === 0 || b.total === 0) return { distinguishable: false, higher: null };
  if (a.low > b.high) return { distinguishable: true, higher: 'a' };
  if (b.low > a.high) return { distinguishable: true, higher: 'b' };
  return { distinguishable: false, higher: null };
}

export const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)} %`);
// „67 % (48–81 %)“ aus einer Quote
export function formatRate(r) {
  if (!r || r.total === 0) return '—';
  return `${pct(r.rate)} [${Math.round(r.low * 100)}–${Math.round(r.high * 100)} %]`;
}
