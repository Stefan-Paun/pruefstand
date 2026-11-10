// Output formats for a diff result (see diff.mjs). Pure: colour is decided by the caller.

const LABEL = { rueckschritt: 'Rückschritt', verbesserung: 'Verbesserung', unveraendert: 'unverändert', neu: 'neu', entfallen: 'entfallen' };
const COLOR = { rueckschritt: '\x1b[31m', verbesserung: '\x1b[32m', neu: '\x1b[36m', entfallen: '\x1b[33m' };
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

// Strips control characters (incl. ESC, so report text cannot drive the terminal).
// eslint-disable-next-line no-control-regex
export const plain = (s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ');

// Makes report text safe inside a Markdown table cell.
export function mdEscape(s) {
  return plain(s)
    .replace(/[&\\`*_|<>[\]~!]/g, (c) => (c === '&' ? '&amp;' : c === '|' ? '\\|' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : `\\${c}`))
    .replace(/@/g, '&#64;') // no accidental @mentions in PR comments
    .replace(/^(\s*)([#+\-=])/, '$1\\$2');
}

const pct = (q) => (q == null ? '—' : `${Math.round(q * 100)} %`);
const cellTxt = (c) => `${c.held}/${c.runs}`;
const pp = (d) => (d == null ? '—' : `${d > 0 ? '+' : ''}${Math.round(d * 100)} pp`);

function verdictLine(d) {
  const c = d.counts;
  return `${c.rueckschritt} Rückschritt(e), ${c.verbesserung} Verbesserung(en), ${c.unveraendert} unverändert, ${c.neu} neu, ${c.entfallen} entfallen`;
}

export function toJson(d) { return JSON.stringify(d, null, 2) + '\n'; }

export function toText(d, { color = false } = {}) {
  const paint = (cat, s) => (color && COLOR[cat] ? `${COLOR[cat]}${s}${RESET}` : s);
  const L = [''];
  L.push(`  pruefstand diff · ${plain(d.old.label)} -> ${plain(d.new.label)}`);
  L.push('');
  for (const w of d.warnings) L.push(`  ! ${plain(w.message)}`);
  if (d.warnings.length) L.push('');
  if (d.summary.length) {
    L.push(`  ${color ? BOLD : ''}Quote gehaltener Angriffe je Profil${color ? RESET : ''}`);
    const w = Math.max(...d.summary.map((s) => plain(s.profile).length), 6);
    for (const s of d.summary) {
      const a = s.attacks;
      L.push(`    ${plain(s.profile).padEnd(w)}  ${pct(a.before.quote).padStart(5)} -> ${pct(a.after.quote).padStart(5)}  ${pp(a.diff).padStart(7)}${s.controls.before.total || s.controls.after.total ? `   (nutzbar ${pct(s.controls.before.quote)} -> ${pct(s.controls.after.quote)})` : ''}`);
    }
    L.push('');
  }
  const shown = d.entries.filter((e) => e.category !== 'unveraendert');
  if (shown.length) {
    const sw = Math.max(...shown.map((e) => plain(e.scenario).length));
    const pw = Math.max(...shown.map((e) => plain(e.profile).length));
    for (const e of shown) L.push(`  ${paint(e.category, LABEL[e.category].padEnd(12))}  ${plain(e.scenario).padEnd(sw)}  ${plain(e.profile).padEnd(pw)}  ${cellTxt(e.before)} -> ${cellTxt(e.after)}`);
    L.push('');
  }
  const noisy = d.entries.filter((e) => e.withinNoise);
  if (noisy.length) L.push(`  ${noisy.length} Zelle(n) mit Abweichung innerhalb des Rauschens gelten als unverändert.`, '');
  for (const [cat, list] of [['neu', d.added], ['entfallen', d.dropped]]) {
    if (list.length) { L.push(`  ${paint(cat, LABEL[cat])}: ${list.map((x) => `${plain(x.scenario)}/${plain(x.profile)}`).join(', ')}`); }
  }
  if (d.added.length || d.dropped.length) L.push('');
  L.push(`  ${verdictLine(d)}`);
  L.push(d.hasRegressions ? `  ${paint('rueckschritt', 'Ergebnis: Rückschritte gefunden')}` : '  Ergebnis: keine Rückschritte');
  L.push('');
  return L.join('\n');
}

export function toMarkdownDiff(d) {
  const L = [];
  L.push('## pruefstand diff');
  L.push('');
  L.push(`**${d.hasRegressions ? 'Rückschritte gefunden' : 'Keine Rückschritte'}** — ${verdictLine(d)}`);
  L.push('');
  L.push(`Alt: \`${mdEscape(d.old.label).replace(/`/g, '')}\` · Neu: \`${mdEscape(d.new.label).replace(/`/g, '')}\``);
  L.push('');
  for (const w of d.warnings) L.push(`> ⚠️ ${mdEscape(w.message)}`);
  if (d.warnings.length) L.push('');
  if (d.summary.length) {
    L.push('| Profil | Quote vorher | Quote nachher | Differenz | Nutzbar vorher → nachher |');
    L.push('|---|---:|---:|---:|---|');
    for (const s of d.summary) L.push(`| ${mdEscape(s.profile)} | ${pct(s.attacks.before.quote)} | ${pct(s.attacks.after.quote)} | ${pp(s.attacks.diff)} | ${pct(s.controls.before.quote)} → ${pct(s.controls.after.quote)} |`);
    L.push('');
  }
  const shown = d.entries.filter((e) => e.category !== 'unveraendert');
  if (shown.length) {
    L.push('| Kategorie | Szenario | Profil | Vorher | Nachher |');
    L.push('|---|---|---|---:|---:|');
    for (const e of shown) L.push(`| ${LABEL[e.category]} | ${mdEscape(e.scenario)} | ${mdEscape(e.profile)} | ${cellTxt(e.before)} | ${cellTxt(e.after)} |`);
    L.push('');
  }
  for (const [cat, list] of [['neu', d.added], ['entfallen', d.dropped]]) {
    if (list.length) L.push(`**${LABEL[cat]}:** ${list.map((x) => `${mdEscape(x.scenario)} / ${mdEscape(x.profile)}`).join(', ')}`, '');
  }
  L.push('_Vorher/Nachher = gehaltene Läufe / gültige Läufe je Zelle. Abweichungen innerhalb des Rauschens zählen als unverändert._');
  return L.join('\n') + '\n';
}
