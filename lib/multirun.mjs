// Ablaufsteuerung für wiederholte Läufe. Die eigentliche Ausführung (runOne)
// wird hineingereicht, damit Tests mit einem Attrappen-Agenten laufen.

export const MAX_RUNS = 20;
export const CONFIRM_ABOVE = 50; // ab so vielen Agentenläufen (bei --runs > 1) wird nachgefragt

export function parseRuns(v) {
  const n = /^\d{1,3}$/.test(String(v)) ? Number(v) : NaN;
  if (v == null || v === '' || !Number.isInteger(n) || n < 1 || n > MAX_RUNS) throw new RangeError(`--runs braucht eine ganze Zahl von 1 bis ${MAX_RUNS} (bekam: ${v})`);
  return n;
}

export function estimate({ scenarios, profiles, models, runs, budgetUsd = 0, timeoutMs = 0 }) {
  const perRun = scenarios * profiles * models;
  const total = perRun * runs;
  return { perRun, total, maxBudgetUsd: total * budgetUsd, maxMinutes: Math.ceil((total * timeoutMs) / 60000) };
}

// Gefragt wird nur bei wiederholten Läufen und großem Aufwand; --runs 1 verhält sich wie bisher.
export function needsConfirmation({ total, runs, yes = false, dryRun = false }) {
  return !yes && !dryRun && runs > 1 && total > CONFIRM_ABOVE;
}

export function estimateText(e, { runs }) {
  const parts = [`${e.perRun} Fälle × ${runs} ${runs === 1 ? 'Lauf' : 'Läufe'} = ${e.total} Agentenläufe`];
  if (e.maxBudgetUsd) parts.push(`Budget-Obergrenze ${e.maxBudgetUsd.toFixed(2)} USD`);
  if (e.maxMinutes) parts.push(`Zeit-Obergrenze ~${e.maxMinutes} min`);
  return parts.join(' · ');
}

// Läufe außen, dann Modell, Profil, Szenario: bricht man ab, sind alle Zellen
// gleich oft gemessen (± 1 Lauf) statt einige gar nicht.
// runOne({scenario, profile, model, run}) liefert ein Ergebnis; wirft es,
// wird ein Fehler-Ergebnis (outcome 'error') eingetragen — nie ein „durchgefallen“.
// Ergebnisse mit `dryRun` werden nicht gesammelt.
export async function runAll({ scenarios, profiles, models, runs, runOne, shouldStop = () => false, onStart, onDone }) {
  const total = scenarios.length * profiles.length * models.length * runs;
  const results = [];
  let n = 0, aborted = false;
  outer:
  for (let run = 1; run <= runs; run++) {
    for (const model of models) for (const profile of profiles) for (const scenario of scenarios) {
      if (shouldStop()) { aborted = true; break outer; }
      n++;
      onStart?.({ n, total, run, model, profile, scenario });
      let r;
      try { r = await runOne({ scenario, profile, model, run }); }
      catch (err) {
        r = { scenario: scenario.id, scenarioTitle: scenario.title, severity: scenario.severity, category: scenario.category, profile: profile.id, profileTitle: profile.title, model, outcome: 'error', evidence: [{ kind: 'error', detail: String(err?.message ?? err) }] };
      }
      onDone?.({ n, total, run, result: r });
      if (!r.dryRun) results.push({ ...r, run });
    }
  }
  return { results, planned: total, done: n, aborted };
}
