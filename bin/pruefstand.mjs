#!/usr/bin/env node
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { getScenarios } from '../lib/scenarios/index.mjs';
import { getProfiles } from '../lib/profiles.mjs';
import { runCase } from '../lib/runner.mjs';
import { toConsole, scoreboard } from '../lib/report/summary.mjs';
import { toHtml } from '../lib/report/html.mjs';

const HELP = `pruefstand — test bench for AI coding agents

Runs your real agent with your real settings against planted prompt-injection
traps and measures what gets through. Fake secrets, a local honeypot, and a
throwaway workspace: nothing leaves your machine.

Usage:
  pruefstand [options]

Options:
  --profiles <a,b>   Defence profiles to run   (default: bare,deny-reads,sandbox)
  --scenarios <a,b>  Scenarios to run          (default: all)
  --model <name>     Model for the agent       (default: haiku)
  --agent <cmd>      Agent command             (default: claude)
  --budget <usd>     Max spend per run         (default: 0.10)
  --max-turns <n>    Max turns per run         (default: 8)
  --timeout <ms>     Timeout per run           (default: 150000)
  --html <path>      Also write an HTML report
  --json <path>      Also write raw results as JSON
  --list             List scenarios and profiles, then exit
  --dry-run          Build workspaces and print the plan; never call the agent
  -h, --help         Show this help

Exit code is non-zero if any non-control scenario was breached.
`;

function parseArgs(argv) {
  const o = { profiles: [], scenarios: [], model: 'haiku', agent: 'claude', budget: 0.1, maxTurns: 8, timeout: 150000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--list') o.list = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--profiles') o.profiles = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--scenarios') o.scenarios = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--model') o.model = next();
    else if (a === '--agent') o.agent = next();
    else if (a === '--budget') o.budget = Number(next());
    else if (a === '--max-turns') o.maxTurns = Number(next());
    else if (a === '--timeout') o.timeout = Number(next());
    else if (a === '--html') o.html = next();
    else if (a === '--json') o.json = next();
    else { console.error(`unknown option: ${a}`); process.exit(2); }
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { process.stdout.write(HELP); return; }

  const scenarios = getScenarios(o.scenarios);
  const profiles = getProfiles(o.profiles);

  if (o.list) {
    console.log('Scenarios:');
    for (const s of scenarios) console.log(`  ${s.id.padEnd(24)} [${s.severity}] ${s.title}`);
    console.log('\nProfiles:');
    for (const p of profiles) console.log(`  ${p.id.padEnd(24)} ${p.description}`);
    return;
  }

  const total = scenarios.length * profiles.length;
  console.log(`\n  pruefstand · ${scenarios.length} scenarios × ${profiles.length} profiles = ${total} runs${o.dryRun ? ' (dry run)' : ''}\n`);

  const results = [];
  let n = 0;
  for (const profile of profiles) {
    for (const scenario of scenarios) {
      n++;
      process.stdout.write(`  [${n}/${total}] ${profile.id} · ${scenario.id} … `);
      try {
        const r = await runCase({ scenario, profile, agentCmd: o.agent, model: o.model, budgetUsd: o.budget, maxTurns: o.maxTurns, timeoutMs: o.timeout, dryRun: o.dryRun });
        if (o.dryRun) { console.log('planned'); console.log(`        workspace: ${r.workspace}`); }
        else { console.log(r.outcome); results.push(r); }
      } catch (err) {
        console.log(`error: ${err.message}`);
        results.push({ scenario: scenario.id, scenarioTitle: scenario.title, severity: scenario.severity, profile: profile.id, profileTitle: profile.title, outcome: 'error', evidence: [{ kind: 'error', detail: err.message }] });
      }
    }
  }

  if (o.dryRun) return;

  console.log('\n' + '─'.repeat(60));
  process.stdout.write(toConsole(results));
  console.log('─'.repeat(60));
  console.log('  Scoreboard (held / scenarios, controls excluded):');
  for (const row of scoreboard(results)) console.log(`    ${row.title.padEnd(26)} ${row.held}/${row.total}`);

  const costUsd = results.reduce((a, r) => a + (r.costUsd || 0), 0);
  console.log(`\n  Total: ${costUsd.toFixed(3)} USD\n`);

  if (o.html) { await ensureDir(o.html); await writeFile(o.html, toHtml(results, { when: new Date().toISOString().slice(0, 16).replace('T', ' '), model: o.model, costUsd })); console.log(`  HTML:  ${o.html}`); }
  if (o.json) { await ensureDir(o.json); await writeFile(o.json, JSON.stringify(results, null, 2)); console.log(`  JSON:  ${o.json}`); }

  const breached = results.filter((r) => r.severity !== 'control' && !['clean', 'read', 'attempted'].includes(r.outcome));
  process.exit(breached.length ? 1 : 0);
}

async function ensureDir(p) { await mkdir(path.dirname(path.resolve(p)), { recursive: true }); }

main().catch((e) => { console.error(e); process.exit(2); });
