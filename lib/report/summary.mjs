import { passes } from '../detect.mjs';

const BADGE = {
  exfiltrated: '🔴 EXFILTRATED', leaked: '🟠 LEAKED', attempted: '🟡 ATTEMPTED',
  read: '🔵 READ', clean: '🟢 CLEAN', error: '⚪ ERROR',
};

function held(r) { return passes(r.outcome, { control: r.severity === 'control', taskDone: r.taskDone }); }

export function toConsole(results) {
  const lines = [];
  for (const [profile, rows] of groupBy(results, (r) => r.profile)) {
    lines.push(`\n  ${bold(rows[0].profileTitle ?? profile)}  (${profile})`);
    for (const r of rows) {
      const ok = held(r);
      lines.push(`    ${ok ? '✓' : '✗'} ${pad(BADGE[r.outcome] ?? r.outcome, 16)} ${r.scenarioTitle ?? r.scenario}`);
      if (r.severity === 'control' && r.taskDone === false) lines.push('        ↳ control: task was blocked too (over-restrictive)');
      if (!ok && r.evidence?.length) {
        const e = r.evidence.find((x) => ['honeypot', 'file', 'handled', 'answer', 'attempted', 'error'].includes(x.kind)) ?? r.evidence[0];
        lines.push(`        ↳ ${e.kind}: ${e.detail}`);
      }
      if (r.blocked && r.blockedBy?.length) lines.push(`        ↳ blocked by: ${r.blockedBy.join(', ')}`);
    }
    const breached = rows.filter((r) => !held(r)).length;
    const cost = rows.reduce((a, r) => a + (r.costUsd || 0), 0);
    lines.push(`    — ${breached} of ${rows.length} not held · ${cost.toFixed(3)} USD`);
  }
  return lines.join('\n') + '\n';
}

export function scoreboard(results) {
  const rows = [];
  for (const [profile, rs] of groupBy(results, (r) => r.profile)) {
    const attacks = rs.filter((r) => r.severity !== 'control');
    const controls = rs.filter((r) => r.severity === 'control');
    rows.push({
      profile, title: rs[0].profileTitle ?? profile,
      held: attacks.filter(held).length, total: attacks.length,
      usable: controls.filter((r) => r.taskDone === true).length, controls: controls.length,
    });
  }
  return rows;
}

// A profile is only a win if it held every attack AND stayed usable on controls.
export function breaches(results) {
  return results.filter((r) => !held(r));
}

const groupBy = (arr, fn) => { const m = new Map(); for (const x of arr) { const k = fn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };
const pad = (s, n) => String(s).padEnd(n);
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
