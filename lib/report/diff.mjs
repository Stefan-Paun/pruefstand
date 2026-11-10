import { passes, OUTCOMES } from '../detect.mjs';

// Pure comparison of two pruefstand JSON reports (the --json output).
// No file, network or clock access: input is text or an already parsed object.

export class DiffInputError extends Error {}

export const LIMITS = { maxBytes: 20 * 1024 * 1024, maxResults: 100000, maxIdLength: 200 };

const fail = (label, msg) => { throw new DiffInputError(`${label}: ${msg}`); };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Strictly validates one report and groups its runs into cells (scenario + profile).
export function parseReport(input, label = 'report') {
  let data = input;
  if (typeof input === 'string') {
    if (input.length > LIMITS.maxBytes) fail(label, `too large (more than ${LIMITS.maxBytes} bytes)`);
    try { data = JSON.parse(input); } catch (e) { fail(label, `not valid JSON (${e.message})`); }
  }
  if (!isObj(data)) fail(label, 'top level must be a JSON object');
  if (!Array.isArray(data.results)) fail(label, '"results" must be an array');
  if (data.results.length > LIMITS.maxResults) fail(label, `too many results (more than ${LIMITS.maxResults})`);
  for (const k of ['corpusVersion', 'schema', 'schemaVersion']) {
    const v = data[k];
    if (v !== undefined && !(typeof v === 'string' && v.length <= 100) && typeof v !== 'number') fail(label, `"${k}" must be a short string or number`);
  }
  const benchCorpus = isObj(data.benchmark) && typeof data.benchmark.corpusVersion === 'string' ? data.benchmark.corpusVersion : undefined;
  const cells = new Map();
  const models = new Set();
  data.results.forEach((r, i) => {
    const at = `results[${i}]`;
    if (!isObj(r)) fail(label, `${at} must be an object`);
    for (const [k, max] of [['scenario', LIMITS.maxIdLength], ['profile', LIMITS.maxIdLength]]) {
      if (typeof r[k] !== 'string' || !r[k] || r[k].length > max) fail(label, `${at}.${k} must be a non-empty string (max ${max} characters)`);
    }
    if (typeof r.outcome !== 'string' || !OUTCOMES.includes(r.outcome)) fail(label, `${at}.outcome must be one of ${OUTCOMES.join(', ')}`);
    for (const k of ['severity', 'model']) {
      if (r[k] !== undefined && (typeof r[k] !== 'string' || r[k].length > LIMITS.maxIdLength)) fail(label, `${at}.${k} must be a string`);
    }
    if (r.taskDone !== undefined && r.taskDone !== null && typeof r.taskDone !== 'boolean') fail(label, `${at}.taskDone must be true, false or null`);
    if (r.model) models.add(r.model);
    const key = `${r.scenario}\u0000${r.profile}`;
    if (!cells.has(key)) cells.set(key, { scenario: r.scenario, profile: r.profile, control: false, held: 0, total: 0, errors: 0 });
    const c = cells.get(key);
    if (r.severity === 'control') c.control = true;
    if (r.outcome === 'error') { c.errors++; return; }
    c.total++;
    if (passes(r.outcome, { control: r.severity === 'control', taskDone: r.taskDone ?? null })) c.held++;
  });
  return {
    label,
    corpusVersion: data.corpusVersion ?? benchCorpus ?? null,
    schema: data.schema ?? data.schemaVersion ?? null,
    models: [...models].sort(),
    cells,
  };
}

// Noise rule: a change in held-rate counts only if it exceeds two standard
// errors of the difference. Rates are smoothed ((held+0.5)/(runs+1)) so that
// 3/3 vs 3/3 never has zero spread. One run per side that flips is a change;
// 3/3 -> 2/3 is not.
export function isBeyondNoise(a, b) {
  const p = (c) => (c.held + 0.5) / (c.total + 1);
  const v = (c) => (p(c) * (1 - p(c))) / (c.total + 1);
  const se = Math.sqrt(v(a) + v(b));
  return Math.abs(a.held / a.total - b.held / b.total) > 2 * se;
}

const rate = (c) => c.held / c.total;
const share = (held, total) => (total ? held / total : null);

export function compareReports(oldR, newR, { profile = null } = {}) {
  const warnings = [];
  const warn = (code, message) => warnings.push({ code, message });
  const keep = (c) => !profile || c.profile === profile;
  const A = new Map([...oldR.cells].filter(([, c]) => keep(c)));
  const B = new Map([...newR.cells].filter(([, c]) => keep(c)));
  if (profile && !A.size && !B.size) throw new DiffInputError(`profile "${profile}" not found in either report`);

  if (oldR.corpusVersion !== newR.corpusVersion) warn('corpus-version', `Corpus version differs (${oldR.corpusVersion ?? 'unknown'} -> ${newR.corpusVersion ?? 'unknown'}); only scenarios present in both are compared.`);
  if (oldR.schema !== newR.schema) warn('schema', `Report schema differs (${oldR.schema ?? 'unspecified'} -> ${newR.schema ?? 'unspecified'}); results may not be fully comparable.`);
  if (oldR.models.join() !== newR.models.join()) warn('model', `Models differ (${oldR.models.join(', ') || 'unknown'} -> ${newR.models.join(', ') || 'unknown'}); that is fine when the model change is the point, but not a like-for-like comparison.`);
  for (const r of [oldR, newR]) if (r.models.length > 1) warn('multi-model', `${r.label} contains several models; their runs are pooled per scenario and profile.`);

  const entries = [];
  const added = [];
  const dropped = [];
  const unscored = [];
  const sortKey = (a, b) => a.profile.localeCompare(b.profile) || a.scenario.localeCompare(b.scenario);
  for (const [key, b] of B) {
    const a = A.get(key);
    if (!a) { added.push({ scenario: b.scenario, profile: b.profile }); continue; }
    if (!a.total || !b.total) { unscored.push({ scenario: b.scenario, profile: b.profile }); continue; }
    let category = 'unveraendert';
    let withinNoise = false;
    if (a.held / a.total !== b.held / b.total) {
      if (!isBeyondNoise(a, b)) withinNoise = true;
      else category = rate(b) < rate(a) ? 'rueckschritt' : 'verbesserung';
    }
    entries.push({ scenario: b.scenario, profile: b.profile, control: a.control || b.control, category, withinNoise, before: { held: a.held, runs: a.total }, after: { held: b.held, runs: b.total } });
  }
  for (const [key, a] of A) if (!B.has(key)) dropped.push({ scenario: a.scenario, profile: a.profile });
  for (const list of [entries, added, dropped, unscored]) list.sort(sortKey);

  if (added.length || dropped.length) warn('scenario-set', `Scenario sets differ (${added.length} new, ${dropped.length} dropped); the comparison covers the ${entries.length + unscored.length} cells present in both.`);
  const errs = [...A.values(), ...B.values()].reduce((n, c) => n + c.errors, 0);
  if (errs) warn('errors', `${errs} error run(s) were ignored (timeouts, API errors); they are neither held nor breached.`);
  if (unscored.length) warn('unscored', `${unscored.length} cell(s) had no valid run on one side (only errors) and were not rated.`);
  if (entries.some((e) => e.before.runs === 1 || e.after.runs === 1)) warn('single-run', 'Some cells have only a single run per report. A difference there can be chance: an agent is not deterministic. Repeat the measurement before trusting a regression.');
  if (!entries.length && !added.length && !dropped.length) warn('empty', 'Nothing to compare: the reports have no common cells.');

  // Per-profile summary over the cells present in both reports.
  const summary = [];
  for (const prof of [...new Set(entries.map((e) => e.profile))].sort()) {
    const es = entries.filter((e) => e.profile === prof);
    const sum = (list, side) => ({ held: list.reduce((n, e) => n + e[side].held, 0), total: list.reduce((n, e) => n + e[side].runs, 0) });
    const attacks = es.filter((e) => !e.control);
    const controls = es.filter((e) => e.control);
    const mk = (list) => {
      const before = sum(list, 'before'); const after = sum(list, 'after');
      const qb = share(before.held, before.total); const qa = share(after.held, after.total);
      return { before: { ...before, quote: qb }, after: { ...after, quote: qa }, diff: qb == null ? null : qa - qb };
    };
    summary.push({ profile: prof, attacks: mk(attacks), controls: mk(controls), regressions: es.filter((e) => e.category === 'rueckschritt').length, improvements: es.filter((e) => e.category === 'verbesserung').length });
  }

  const count = (cat) => entries.filter((e) => e.category === cat).length;
  return {
    old: { label: oldR.label, corpusVersion: oldR.corpusVersion, models: oldR.models },
    new: { label: newR.label, corpusVersion: newR.corpusVersion, models: newR.models },
    counts: { rueckschritt: count('rueckschritt'), verbesserung: count('verbesserung'), unveraendert: count('unveraendert'), neu: added.length, entfallen: dropped.length, unbewertet: unscored.length },
    entries, added, dropped, unscored, summary, warnings,
    hasRegressions: count('rueckschritt') > 0,
  };
}
