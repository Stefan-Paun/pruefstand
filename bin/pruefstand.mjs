#!/usr/bin/env node
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { getScenarios, scenarios as builtin, CORPUS_VERSION } from '../lib/scenarios/index.mjs';
import { loadScenariosDir } from '../lib/scenarios/load.mjs';
import { getProfiles } from '../lib/profiles.mjs';
import { parseArgs } from '../lib/cli.mjs';
import { runCase } from '../lib/runner.mjs';
import { toConsole, scoreboard, breaches } from '../lib/report/summary.mjs';
import { toHtml } from '../lib/report/html.mjs';
import { benchmark, toMarkdown } from '../lib/report/benchmark.mjs';
import { buildReport, aggregate, repeatsConsole } from '../lib/report/runs.mjs';
import { runAll, parseRuns, estimate, estimateText, needsConfirmation, CONFIRM_ABOVE } from '../lib/multirun.mjs';
import { createInterface } from 'node:readline/promises';

const HELP = `pruefstand — test bench for AI coding agents  (corpus ${CORPUS_VERSION})

Runs your real agent with your real settings against a versioned corpus of
planted prompt-injection traps and scores how well each defence profile holds.
Fake secrets, a local honeypot, a throwaway workspace: nothing leaves your box.

Usage:
  pruefstand [options]
  pruefstand diff <old.json> <new.json>   compare two reports (see: pruefstand diff --help)

Options:
  --profiles <a,b>   Defence profiles to run   (default: bare,deny-reads,sandbox)
  --scenarios <a,b>  Scenarios to run          (default: all)
  --scenarios-dir <d> Load extra scenarios (.json/.mjs) from a folder
  --model <name>     Model for the agent       (default: haiku)
  --models <a,b>     Benchmark across models    (overrides --model)
  --agent <cmd>      Agent command             (default: claude)
  --runs <n>         Runs per scenario × profile (1–20, default: 1); with n > 1 the
                     report shows rates with 95% Wilson intervals and flags flaky cases
  --ja, --yes        Skip the confirmation for large --runs batches
  --budget <usd>     Max spend per run         (default: 0.10)
  --max-turns <n>    Max turns per run         (default: 8)
  --timeout <ms>     Timeout per run           (default: 150000)
  --html <path>      Also write an HTML report
  --json <path>      Also write results + benchmark as JSON
  --md <path>        Also write a Markdown benchmark report
  --list             List scenarios and profiles, then exit
  --dry-run          Build workspaces and print the plan; never call the agent
  -h, --help         Show this help

Exit code is non-zero if any non-control scenario was breached.
`;

// One-line, length-capped view of a prompt for the dry-run plan.
function shorten(text, max = 200) {
  const one = String(text).replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

async function main() {
  if (process.argv[2] === 'diff') {
    const { runDiff } = await import('../lib/diff-cli.mjs');
    process.exitCode = await runDiff(process.argv.slice(3));
    return;
  }
  let o;
  try { o = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error(e.message); process.exit(2); }
  if (o.help) { process.stdout.write(HELP); return; }

  let extra = [];
  if (o.scenariosDir) {
    try { extra = await loadScenariosDir(o.scenariosDir, { builtinIds: builtin.map((s) => s.id) }); }
    catch (e) { console.error(e.message); process.exit(2); }
  }
  let scenarios, profiles;
  try { scenarios = getScenarios(o.scenarios, extra); profiles = getProfiles(o.profiles); }
  catch (e) { console.error(e.message); process.exit(2); }
  const models = [...new Set(o.models.length ? o.models : [o.model])];

  if (o.list) {
    console.log(`Corpus: ${CORPUS_VERSION}`);
    console.log('\nScenarios:');
    for (const s of scenarios) console.log(`  ${s.id.padEnd(26)} [${(s.category ?? '-').padEnd(14)}] ${s.severity.padEnd(7)} ${s.title}`);
    console.log('\nProfiles:');
    for (const p of profiles) console.log(`  ${p.id.padEnd(26)} ${p.description}`);
    return;
  }

  const runs = o.dryRun ? 1 : o.runs; // a dry run only builds each workspace once
  const est = estimate({ scenarios: scenarios.length, profiles: profiles.length, models: models.length, runs: o.runs, budgetUsd: o.budget, timeoutMs: o.timeout });
  const total = scenarios.length * profiles.length * models.length * runs;
  const modelNote = models.length > 1 ? ` × ${models.length} models` : '';
  console.log(`\n  pruefstand · corpus ${CORPUS_VERSION}`);
  console.log(`  ${scenarios.length} scenarios × ${profiles.length} profiles${modelNote} = ${est.perRun} cases${o.runs > 1 ? ` × ${o.runs} runs = ${est.total} agent runs` : ' = ' + est.total + ' runs'}${o.dryRun ? ' (dry run)' : ''}`);
  if (o.runs > 1) console.log(`  Aufwand: ${estimateText(est, { runs: o.runs })}`);
  console.log('');

  if (needsConfirmation({ total: est.total, runs: o.runs, yes: o.yes, dryRun: o.dryRun })) {
    if (!process.stdin.isTTY) {
      console.error(`  ${est.total} Agentenläufe (> ${CONFIRM_ABOVE}) brauchen eine Bestätigung. Ohne Terminal: --ja angeben oder --runs/--scenarios verkleinern.`);
      process.exit(2);
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question(`  ${est.total} Agentenläufe starten? [j/N] `)).trim().toLowerCase();
    rl.close();
    if (!['j', 'ja', 'y', 'yes'].includes(answer)) { console.log('  Abgebrochen, nichts gestartet.'); return; }
  }

  // Strg-C: der laufende Fall wird noch zu Ende gemessen, dann werden die bisherigen
  // Ergebnisse geschrieben. Zweites Strg-C beendet sofort.
  let stop = false;
  process.on('SIGINT', () => {
    if (stop) process.exit(130);
    stop = true;
    console.log('\n  Strg-C: stoppe nach dem laufenden Fall und schreibe die bisherigen Ergebnisse (nochmal Strg-C = sofort beenden).');
  });

  const out = await runAll({
    scenarios, profiles, models, runs,
    shouldStop: () => stop,
    runOne: ({ scenario, profile, model }) => runCase({ scenario, profile, agentCmd: o.agent, model, budgetUsd: o.budget, maxTurns: o.maxTurns, timeoutMs: o.timeout, dryRun: o.dryRun }),
    onStart: ({ n, total: t, run, model, profile, scenario }) => {
      const tag = (models.length > 1 ? `${model} · ` : '') + (runs > 1 ? `run ${run}/${runs} · ` : '');
      process.stdout.write(`  [${n}/${t}] ${tag}${profile.id} · ${scenario.id} … `);
    },
    onDone: ({ result: r }) => {
      if (r.dryRun) { console.log('planned'); console.log(`        prompt: ${shorten(r.prompt)}`); console.log(`        files:  ${r.files.join(', ')}`); }
      else if (r.outcome === 'error') console.log(`error: ${r.evidence?.[0]?.detail ?? ''}`);
      else console.log(r.outcome);
    },
  });
  const results = out.results;

  if (o.dryRun) return;
  if (!results.length) { console.log('\n  Keine Ergebnisse.'); process.exit(out.aborted ? 130 : 0); }
  const agg = aggregate(results, { runsPlanned: runs });

  console.log('\n' + '─'.repeat(60));
  process.stdout.write(runs > 1 ? repeatsConsole(agg) : toConsole(results));
  if (out.aborted) console.log(`\n  ABGEBROCHEN: ${agg.missingRuns} von ${out.planned} geplanten Läufen fehlen.`);

  const bench = benchmark(results, { corpusVersion: CORPUS_VERSION, models });
  console.log('─'.repeat(60));
  console.log(`  Benchmark · corpus ${CORPUS_VERSION} · ${bench.attacksPerRun} attacks, ${bench.controlsPerRun} controls`);
  for (const c of bench.cells) {
    const score = c.resilienceScore == null ? ' — ' : `${String(c.resilienceScore).padStart(3)}/100`;
    const tag = models.length > 1 ? `${c.model} · ` : '';
    console.log(`    ${score}  resilience  ${tag}${c.profileTitle.padEnd(26)} attacks ${c.attacksHeld}/${c.attacksTotal} · usable ${c.controlsUsable}/${c.controlsTotal}`);
  }

  const costUsd = results.reduce((a, r) => a + (r.costUsd || 0), 0);
  console.log(`\n  Total: ${costUsd.toFixed(3)} USD\n`);

  if (o.html) { await ensureDir(o.html); await writeFile(o.html, toHtml(results, { when: new Date().toISOString().slice(0, 16).replace('T', ' '), model: models.join(', '), costUsd, corpusVersion: CORPUS_VERSION, repeats: agg })); console.log(`  HTML:  ${o.html}`); }
  if (o.json) { await ensureDir(o.json); await writeFile(o.json, JSON.stringify(buildReport({ corpusVersion: CORPUS_VERSION, benchmark: bench, results, runsPlanned: runs, aborted: out.aborted }), null, 2)); console.log(`  JSON:  ${o.json}`); }
  if (o.md) { await ensureDir(o.md); await writeFile(o.md, toMarkdown(bench, agg)); console.log(`  MD:    ${o.md}`); }

  process.exit(breaches(results).length ? 1 : out.aborted ? 130 : 0);
}

async function ensureDir(p) { await mkdir(path.dirname(path.resolve(p)), { recursive: true }); }

main().catch((e) => { console.error(e); process.exit(2); });
