import { passes } from '../detect.mjs';
import { recommendationLine } from './summary.mjs';

const COLORS = { exfiltrated: '#ff5555', leaked: '#ffb86c', attempted: '#f1fa8c', read: '#8be9fd', clean: '#50fa7b', error: '#6272a4' };

function held(r) { return passes(r.outcome, { control: r.severity === 'control', taskDone: r.taskDone }); }

// Self-contained Dracula-themed report. No external assets, no tracking.
export function toHtml(results, meta = {}) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const multiModel = new Set(results.map((r) => r.model)).size > 1;
  const cols = [...new Set(results.map((r) => `${r.model ?? '?'}\u0000${r.profile}`))];
  const scenarios = [...new Set(results.map((r) => r.scenario))];
  const colCell = (col, sc) => {
    const [model, profile] = col.split('\u0000');
    return results.find((r) => r.scenario === sc && r.profile === profile && String(r.model ?? '?') === model);
  };
  const colTitle = (col) => {
    const [model, profile] = col.split('\u0000');
    const r = results.find((x) => x.profile === profile && String(x.model ?? '?') === model);
    const name = r?.profileTitle || profile;
    return multiModel ? `${model} · ${name}` : name;
  };
  const cell = (r) => {
    if (!r) return '<td>—</td>';
    const tip = (r.evidence || []).map((e) => `${e.kind}: ${e.detail}`).join(' | ');
    const ring = held(r) ? '' : ' brk';
    const ctrl = r.severity === 'control' && r.taskDone === false;
    return `<td class="o${ring}" style="--c:${COLORS[r.outcome] || '#6272a4'}" title="${esc(tip)}">${esc(r.outcome)}${ctrl ? ' ⚠' : ''}</td>`;
  };
  const rowFor = (sc) => {
    const t = results.find((r) => r.scenario === sc);
    const tag = t?.severity === 'control' ? ' <small>(control)</small>' : '';
    return `<tr><th>${esc(t?.scenarioTitle ?? sc)}${tag}</th>${cols.map((col) => cell(colCell(col, sc))).join('')}</tr>`;
  };
  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Prüfstand-Bericht</title><style>
:root{color-scheme:dark}
body{margin:0;background:#282a36;color:#f8f8f2;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:2rem}
h1{font-size:1.5rem;margin:0 0 .25rem}.sub{color:#6272a4;margin:0 0 2rem}
table{border-collapse:collapse;width:100%;max-width:960px;margin:0 0 1.2rem}
th,td{padding:.55rem .7rem;text-align:left;border-bottom:1px solid #44475a}
thead th{color:#bd93f9;font-weight:600}
td.o{font-variant:small-caps;font-weight:600;color:#282a36;background:var(--c);border-radius:4px;text-align:center}
td.o.brk{outline:2px solid #ff5555;outline-offset:-2px}
tbody th{color:#f8f8f2;font-weight:500}tbody th small{color:#6272a4}
.legend{display:flex;gap:1rem;flex-wrap:wrap;color:#6272a4;font-size:.85rem}
.legend span{display:inline-flex;align-items:center;gap:.35rem}
.legend i{width:.8rem;height:.8rem;border-radius:3px;display:inline-block}
p.rec{color:#f8f8f2;font-weight:600;margin-top:1.2rem}
footer{color:#6272a4;font-size:.8rem;margin-top:2rem}
</style></head><body>
<h1>Prüfstand</h1>
<p class="sub">${esc(meta.when || '')} · Korpus ${esc(meta.corpusVersion || '')} · Modell ${esc(meta.model || '')} · ${results.length} Läufe · ${esc((meta.costUsd || 0).toFixed(3))} USD</p>
<table><thead><tr><th>Szenario \\ Profil</th>${cols.map((col) => `<th>${esc(colTitle(col))}</th>`).join('')}</tr></thead>
<tbody>${scenarios.map(rowFor).join('')}</tbody></table>
<div class="legend">${Object.entries(COLORS).map(([k, c]) => `<span><i style="background:${c}"></i>${k}</span>`).join('')}<span>⚠ control task blocked</span><span>red ring = not held</span></div>
<p class="rec">${esc(recommendationLine(results))}</p>
<footer>Fake-Secrets mit Canary, lokaler Honeypot, Wegwerf-Ordner. Nichts verlässt den Rechner. pruefstand · MIT</footer>
</body></html>`;
}
