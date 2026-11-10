import { passes } from '../detect.mjs';
import { rate, classify, compare } from '../stats.mjs';

export const SCHEMA_VERSION = 2;

const held = (r) => passes(r.outcome, { control: r.severity === 'control', taskDone: r.taskDone });
const key = (...p) => p.join('\u0000');

// Fasst Einzelläufe (je Ergebnis ein `run`-Feld, fehlt es: Lauf 1) je Zelle
// Szenario × Profil × Modell zusammen.
//  - "bestanden" = wie im übrigen Bericht (passes()); bei Kontrollen zählt auch taskDone.
//  - Ausführungsfehler (outcome 'error') zählen NICHT als durchgefallen: sie stehen
//    in `errors` und gehen nicht in die Quote ein.
//  - `missing` = geplante Läufe, zu denen es kein Ergebnis gibt (Abbruch).
export function aggregate(results, { runsPlanned } = {}) {
  const planned = runsPlanned ?? Math.max(1, ...results.map((r) => r.run ?? 1));
  const cellMap = new Map();
  for (const r of results) {
    const k = key(r.model ?? '?', r.profile, r.scenario);
    if (!cellMap.has(k)) cellMap.set(k, []);
    cellMap.get(k).push(r);
  }
  const cells = [...cellMap.values()].map((rs) => {
    const first = rs[0];
    const sorted = [...rs].sort((a, b) => (a.run ?? 1) - (b.run ?? 1));
    const ok = sorted.filter((r) => r.outcome !== 'error');
    const passed = ok.filter(held).length;
    return {
      model: first.model ?? '?', profile: first.profile, profileTitle: first.profileTitle ?? first.profile,
      scenario: first.scenario, scenarioTitle: first.scenarioTitle ?? first.scenario,
      severity: first.severity, category: first.category,
      control: first.severity === 'control',
      runs: sorted.map((r) => ({ run: r.run ?? 1, outcome: r.outcome, passed: r.outcome === 'error' ? null : held(r) })),
      ...rate(passed, ok.length),
      errors: sorted.length - ok.length,
      missing: Math.max(0, planned - sorted.length),
      status: classify(passed, ok.length),
    };
  });
  cells.sort((a, b) => a.model.localeCompare(b.model) || a.profile.localeCompare(b.profile) || a.scenario.localeCompare(b.scenario));

  // Gesamtquote je Modell × Profil: Angriffe und Kontrollen getrennt.
  // Die Läufe werden als unabhängige Versuche gezählt (grobe Näherung, siehe BENCHMARK.md).
  const profMap = new Map();
  for (const c of cells) {
    const k = key(c.model, c.profile);
    if (!profMap.has(k)) profMap.set(k, { model: c.model, profile: c.profile, profileTitle: c.profileTitle, a: [0, 0], c: [0, 0], errors: 0, missing: 0, flaky: 0 });
    const p = profMap.get(k);
    const t = c.control ? p.c : p.a;
    t[0] += c.passed; t[1] += c.total;
    p.errors += c.errors; p.missing += c.missing;
    if (c.status === 'flaky') p.flaky++;
  }
  const profiles = [...profMap.values()].map((p) => ({
    model: p.model, profile: p.profile, profileTitle: p.profileTitle,
    attacks: rate(p.a[0], p.a[1]), controls: rate(p.c[0], p.c[1]),
    errors: p.errors, missing: p.missing, flakyCells: p.flaky,
  })).sort((a, b) => a.model.localeCompare(b.model) || a.profile.localeCompare(b.profile));

  // Profilvergleich je Modell, nur über die Angriffsquote.
  const comparisons = [];
  for (let i = 0; i < profiles.length; i++) for (let j = i + 1; j < profiles.length; j++) {
    const a = profiles[i], b = profiles[j];
    if (a.model !== b.model) continue;
    const c = compare(a.attacks, b.attacks);
    comparisons.push({ model: a.model, a: a.profile, b: b.profile, distinguishable: c.distinguishable, higher: c.higher == null ? null : c.higher === 'a' ? a.profile : b.profile });
  }

  const missing = cells.reduce((s, c) => s + c.missing, 0);
  return { runsPlanned: planned, cells, profiles, comparisons, missingRuns: missing, errorRuns: cells.reduce((s, c) => s + c.errors, 0) };
}

// Baut das JSON-Dokument (Schema 2). `benchmark` und `results` bleiben wie in Schema 1,
// damit alte Leser weiter funktionieren; Neues steht in `runs` und `repeats`.
export function buildReport({ corpusVersion, benchmark, results, runsPlanned, aborted = false }) {
  const agg = aggregate(results, { runsPlanned });
  return {
    schemaVersion: SCHEMA_VERSION,
    corpusVersion,
    runs: { planned: agg.runsPlanned, aborted, missing: agg.missingRuns, errors: agg.errorRuns },
    benchmark,
    repeats: agg,
    results,
  };
}

// Liest Schema 1 (ohne schemaVersion, ein Lauf je Zelle) und 2.
// Gibt { schemaVersion, corpusVersion, benchmark, results, repeats } zurück.
export function readReport(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.results)) throw new Error('Kein Prüfstand-Bericht (results fehlt)');
  const v = doc.schemaVersion ?? 1;
  if (!Number.isInteger(v) || v < 1 || v > SCHEMA_VERSION) throw new Error(`Berichtsformat ${doc.schemaVersion} wird nicht unterstützt (bekannt: 1–${SCHEMA_VERSION})`);
  const results = doc.results.map((r) => ({ ...r, run: r.run ?? 1 }));
  const planned = v >= 2 ? doc.runs?.planned : 1;
  return { schemaVersion: v, corpusVersion: doc.corpusVersion, benchmark: doc.benchmark, results, repeats: aggregate(results, { runsPlanned: planned }) };
}
