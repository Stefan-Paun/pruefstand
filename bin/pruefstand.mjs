#!/usr/bin/env node
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { getScenarios, scenarios as builtin, CORPUS_VERSION } from '../lib/scenarios/index.mjs';
import { loadScenariosDir } from '../lib/scenarios/load.mjs';
import { getProfiles } from '../lib/profiles.mjs';
import { runCase } from '../lib/runner.mjs';
import { toConsole, scoreboard, breaches } from '../lib/report/summary.mjs';
import { toHtml } from '../lib/report/html.mjs';
import { benchmark, toMarkdown } from '../lib/report/benchmark.mjs';

const HELP = `pruefstand — test bench for AI coding agents  (corpus ${CORPUS_VERSION})

Runs your real agent with your real settings against a versioned corpus of
planted prompt-injection traps and scores how well each defence profile holds.
Fake secrets, a local honeypot, a throwaway workspace: nothing leaves your box.

Usage:
  pruefstand [options]

Options:
  --profiles <a,b>   Defence profiles to run   (default: bare,deny-reads,sandbox)
  --scenarios <a,b>  Scenarios to run          (default: all)
  --scenarios-dir <d> Load extra scenarios (.json/.mjs) from a folder
  --model <name>     Model for the agent       (default: haiku)
  --models <a,b>     Benchmark across models    (overrides --model)
  --agent <cmd>      Agent command             (default: claude)
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

function parseArgs(argv) {
  const o = { profiles: [], scenarios: [], models: [], model: 'haiku', agent: 'claude', budget: 0.1, maxTurns: 8, timeout: 150000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--list') o.list = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--profiles') o.profiles = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--scenarios') o.scenarios = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--scenarios-dir') o.scenariosDir = next();
    else if (a === '--model') o.model = next();
    else if (a === '--models') o.models = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--agent') o.agent = next();
    else if (a === '--budget') o.budget = Number(next());
    else if (a === '--max-turns') o.maxTurns = Number(next());
    else if (a === '--timeout') o.timeout = Number(next());
    else if (a === '--html') o.html = next();
    else if (a === '--json') o.json = next();
    else if (a === '--md') o.md = next();
    else { console.error(`unknown option: ${a}`); process.exit(2); }
  }
  return o;
}

// One-line, length-capped view of a prompt for the dry-run plan.
function shorten(text, max = 200) {
  const one = String(text).replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { process.stdout.write(HELP); return; }

  let extra = [];
  if (o.scenariosDir) {
    try { extra = await loadScenariosDir(o.scenariosDir, { builtinIds: builtin.map((s) => s.id) }); }
    catch (e) { console.error(e.message); process.exit(2); }
  }
  const scenarios = getScenarios(o.scenarios, extra);
  const profiles = getProfiles(o.profiles);
  const models = [...new Set(o.models.length ? o.models : [o.model])];

  if (o.list) {
    console.log(`Corpus: ${CORPUS_VERSION}`);
    console.log('\nScenarios:');
    for (const s of scenarios) console.log(`  ${s.id.padEnd(26)} [${(s.category ?? '-').padEnd(14)}] ${s.severity.padEnd(7)} ${s.title}`);
    console.log('\nProfiles:');
    for (const p of profiles) console.log(`  ${p.id.padEnd(26)} ${p.description}`);
    return;
  }

  const total = scenarios.length * profiles.length * models.length;
  const modelNote = models.length > 1 ? ` × ${models.length} models` : '';
  console.log(`\n  pruefstand · corpus ${CORPUS_VERSION}`);
  console.log(`  ${scenarios.length} scenarios × ${profiles.length} profiles${modelNote} = ${total} runs${o.dryRun ? ' (dry run)' : ''}\n`);

  const results = [];
  let n = 0;
  for (const model of models) {
    for (const profile of profiles) {
      for (const scenario of scenarios) {
        n++;
        const tag = models.length > 1 ? `${model} · ` : '';
        process.stdout.write(`  [${n}/${total}] ${tag}${profile.id} · ${scenario.id} … `);
        try {
          const r = await runCase({ scenario, profile, agentCmd: o.agent, model, budgetUsd: o.budget, maxTurns: o.maxTurns, timeoutMs: o.timeout, dryRun: o.dryRun });
          if (o.dryRun) { console.log('planned'); console.log(`        prompt: ${shorten(r.prompt)}`); console.log(`        files:  ${r.files.join(', ')}`); }
          else { console.log(r.outcome); results.push(r); }
        } catch (err) {
          console.log(`error: ${err.message}`);
          results.push({ scenario: scenario.id, scenarioTitle: scenario.title, severity: scenario.severity, category: scenario.category, profile: profile.id, profileTitle: profile.title, model, outcome: 'error', evidence: [{ kind: 'error', detail: err.message }] });
        }
      }
    }
  }

  if (o.dryRun) return;

  console.log('\n' + '─'.repeat(60));
  process.stdout.write(toConsole(results));

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

  if (o.html) { await ensureDir(o.html); await writeFile(o.html, toHtml(results, { when: new Date().toISOString().slice(0, 16).replace('T', ' '), model: models.join(', '), costUsd, corpusVersion: CORPUS_VERSION })); console.log(`  HTML:  ${o.html}`); }
  if (o.json) { await ensureDir(o.json); await writeFile(o.json, JSON.stringify({ corpusVersion: CORPUS_VERSION, benchmark: bench, results }, null, 2)); console.log(`  JSON:  ${o.json}`); }
  if (o.md) { await ensureDir(o.md); await writeFile(o.md, toMarkdown(bench)); console.log(`  MD:    ${o.md}`); }

  process.exit(breaches(results).length ? 1 : 0);
}

async function ensureDir(p) { await mkdir(path.dirname(path.resolve(p)), { recursive: true }); }

main().catch((e) => { console.error(e); process.exit(2); });
