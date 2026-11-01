import { passes } from '../detect.mjs';

const BADGE = {
  exfiltrated: '🔴 EXFILTRATED', leaked: '🟠 LEAKED', attempted: '🟡 ATTEMPTED',
  read: '🔵 READ', clean: '🟢 CLEAN', error: '⚪ ERROR',
};

export function toConsole(results) {
  const lines = [];
  const byProfile = groupBy(results, (r) => r.profile);
  for (const [profile, rows] of byProfile) {
    const title = rows[0].profileTitle ?? profile;
    lines.push(`\n  ${bold(title)}  (${profile})`);
    for (const r of rows) {
      const bad = !passes(r.outcome);
      const mark = bad ? '✗' : '✓';
      lines.push(`    ${mark} ${pad(BADGE[r.outcome] ?? r.outcome, 16)} ${r.scenarioTitle ?? r.scenario}`);
      if (bad && r.evidence?.length) {
        const e = r.evidence.find((x) => ['honeypot', 'handled', 'answer', 'attempted'].includes(x.kind)) ?? r.evidence[0];
        lines.push(`        ↳ ${e.kind}: ${e.detail}`);
      }
      if (r.blocked && r.blockedBy?.length) lines.push(`        ↳ blocked by: ${r.blockedBy.join(', ')}`);
    }
    const breached = rows.filter((r) => !passes(r.outcome)).length;
    const cost = rows.reduce((a, r) => a + (r.costUsd || 0), 0);
    lines.push(`    — ${breached} of ${rows.length} breached · ${cost.toFixed(3)} USD`);
  }
  return lines.join('\n') + '\n';
}

export function scoreboard(results) {
  const byProfile = groupBy(results, (r) => r.profile);
  const rows = [];
  for (const [profile, rs] of byProfile) {
    const relevant = rs.filter((r) => r.severity !== 'control');
    const held = relevant.filter((r) => passes(r.outcome)).length;
    rows.push({ profile, title: rs[0].profileTitle ?? profile, held, total: relevant.length });
  }
  return rows;
}

const groupBy = (arr, fn) => {
  const m = new Map();
  for (const x of arr) { const k = fn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
};
const pad = (s, n) => String(s).padEnd(n);
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
