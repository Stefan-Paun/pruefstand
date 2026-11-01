import { passes } from '../detect.mjs';

const COLORS = { exfiltrated: '#ff5555', leaked: '#ffb86c', attempted: '#f1fa8c', read: '#8be9fd', clean: '#50fa7b', error: '#6272a4' };

// Self-contained Dracula-themed report. No external assets, no tracking.
export function toHtml(results, meta = {}) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const profiles = [...new Set(results.map((r) => r.profile))];
  const scenarios = [...new Set(results.map((r) => r.scenario))];
  const cell = (r) => r ? `<td class="o" style="--c:${COLORS[r.outcome] || '#6272a4'}" title="${esc((r.evidence || []).map((e) => e.kind + ': ' + e.detail).join(' | '))}">${esc(r.outcome)}</td>` : '<td>—</td>';
  const rowFor = (sc) => {
    const title = results.find((r) => r.scenario === sc)?.scenarioTitle ?? sc;
    const cells = profiles.map((p) => cell(results.find((r) => r.scenario === sc && r.profile === p))).join('');
    return `<tr><th>${esc(title)}</th>${cells}</tr>`;
  };
  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Prüfstand-Bericht</title><style>
:root{color-scheme:dark}
body{margin:0;background:#282a36;color:#f8f8f2;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:2rem}
h1{font-size:1.5rem;margin:0 0 .25rem}.sub{color:#6272a4;margin:0 0 2rem}
table{border-collapse:collapse;width:100%;max-width:900px;margin:0 0 2rem}
th,td{padding:.55rem .7rem;text-align:left;border-bottom:1px solid #44475a}
thead th{color:#bd93f9;font-weight:600}
td.o{font-variant:small-caps;font-weight:600;color:#282a36;background:var(--c);border-radius:4px;text-align:center}
tbody th{color:#f8f8f2;font-weight:500}
.legend{display:flex;gap:1rem;flex-wrap:wrap;color:#6272a4;font-size:.85rem}
.legend span{display:inline-flex;align-items:center;gap:.35rem}
.legend i{width:.8rem;height:.8rem;border-radius:3px;display:inline-block}
footer{color:#6272a4;font-size:.8rem;margin-top:2rem}
</style></head><body>
<h1>Prüfstand</h1>
<p class="sub">${esc(meta.when || '')} · Modell ${esc(meta.model || '')} · ${results.length} Läufe · ${esc((meta.costUsd || 0).toFixed(3))} USD</p>
<table><thead><tr><th>Szenario \\ Profil</th>${profiles.map((p) => `<th>${esc(results.find((r) => r.profile === p)?.profileTitle || p)}</th>`).join('')}</tr></thead>
<tbody>${scenarios.map(rowFor).join('')}</tbody></table>
<div class="legend">${Object.entries(COLORS).map(([k, c]) => `<span><i style="background:${c}"></i>${k}</span>`).join('')}</div>
<footer>Fake-Secrets, lokaler Honeypot, Wegwerf-Ordner. Nichts verlässt den Rechner. pruefstand · MIT</footer>
</body></html>`;
}
