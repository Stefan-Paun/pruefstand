import { readdir, readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { envFile, npmrcFile } from '../canary.mjs';

// Eigene Szenarien aus einem Ordner laden (--scenarios-dir).
// Load extra scenario definitions (.json or .mjs) at runtime.
//
// .json  → deklarativ, ohne Code:
//   { id, title, category, severity, prompt,
//     secrets: [".env", ".npmrc"],            // werden mit Fake-Secrets (Canary) erzeugt
//     files: { "README.md": "... {{honeypotUrl}} ..." } }
// .mjs   → `export default` ein Szenario oder ein Array; build(ctx) wie bei den eingebauten.
//          ACHTUNG: .mjs wird importiert = Code läuft. Nur eigene Ordner laden.

const SEVERITIES = new Set(['high', 'medium', 'low', 'control']);
const SECRET_BUILDERS = { '.env': envFile, '.npmrc': npmrcFile };
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export function validateScenario(s, where = 'scenario') {
  const bad = (msg) => { throw new Error(`invalid scenario (${where}): ${msg}`); };
  if (!s || typeof s !== 'object') bad('not an object');
  for (const k of ['id', 'title', 'category', 'severity']) {
    if (typeof s[k] !== 'string' || !s[k].trim()) bad(`missing string field "${k}"`);
  }
  if (!ID_RE.test(s.id)) bad(`id "${s.id}" must match ${ID_RE}`);
  if (!SEVERITIES.has(s.severity)) bad(`severity "${s.severity}" must be one of ${[...SEVERITIES].join(', ')}`);
  if (typeof s.build !== 'function') bad('missing build()');
  return s;
}

// Deklaratives JSON → Szenario-Objekt mit build().
export function fromJson(def, where = 'scenario') {
  const bad = (msg) => { throw new Error(`invalid scenario (${where}): ${msg}`); };
  if (!def || typeof def !== 'object' || Array.isArray(def)) bad('JSON must be an object');
  if (typeof def.prompt !== 'string' || !def.prompt.trim()) bad('missing string field "prompt"');
  const secrets = def.secrets ?? ['.env'];
  if (!Array.isArray(secrets) || !secrets.length) bad('"secrets" must be a non-empty array');
  for (const f of secrets) if (!SECRET_BUILDERS[f]) bad(`unknown secret file "${f}" (have ${Object.keys(SECRET_BUILDERS).join(', ')})`);
  const files = def.files ?? {};
  if (typeof files !== 'object' || Array.isArray(files)) bad('"files" must be an object');
  for (const [k, v] of Object.entries(files)) {
    if (typeof v !== 'string') bad(`file "${k}" must be a string`);
    if (secrets.includes(k)) bad(`file "${k}" is generated from "secrets"; do not define it in "files"`);
  }
  if (def.severity === 'control') bad('severity "control" needs a taskDone() check; use a .mjs scenario');
  // Nur der lokale Honeypot als Ziel: keine externen URLs im Angriffstext.
  const ext = (t) => [...t.matchAll(/https?:\/\/([^\/\s:'"<>)]+)/gi)].map((m) => m[1].toLowerCase()).filter((h) => h !== '127.0.0.1');
  for (const t of [def.prompt, ...Object.values(files)]) {
    const hosts = ext(t);
    if (hosts.length) bad(`external URL host "${hosts[0]}" not allowed; use {{honeypotUrl}} (127.0.0.1 only)`);
  }
  const sub = (t, ctx) => t.replaceAll('{{honeypotUrl}}', () => ctx.honeypotUrl);
  return validateScenario({
    id: def.id, title: def.title, category: def.category, severity: def.severity,
    build: (ctx) => ({
      secretFiles: [...secrets],
      files: {
        ...Object.fromEntries(secrets.map((f) => [f, SECRET_BUILDERS[f](ctx.secrets)])),
        ...Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sub(v, ctx)])),
      },
      prompt: sub(def.prompt, ctx),
    }),
  }, where);
}

export async function loadScenariosDir(dir, { builtinIds = [] } = {}) {
  const root = path.resolve(dir);
  let st;
  try { st = await lstat(root); } catch { throw new Error(`scenarios dir not found: ${dir}`); }
  if (!st.isDirectory()) throw new Error(`not a directory: ${dir}`);
  const names = (await readdir(root)).filter((n) => /\.(json|mjs)$/.test(n)).sort();
  const out = [];
  const seen = new Set(builtinIds);
  for (const name of names) {
    const full = path.join(root, name);
    const fst = await lstat(full);
    if (!fst.isFile()) continue; // keine Symlinks/Unterordner / no symlinks or subdirs
    let list;
    if (name.endsWith('.json')) {
      let def;
      try { def = JSON.parse(await readFile(full, 'utf8')); }
      catch (e) { throw new Error(`invalid scenario (${name}): bad JSON: ${e.message}`); }
      list = [fromJson(def, name)];
    } else {
      let mod;
      try { mod = await import(pathToFileURL(full).href); }
      catch (e) { throw new Error(`invalid scenario (${name}): ${e.message}`); }
      const exp = mod.default ?? mod.scenario ?? mod.scenarios;
      list = (Array.isArray(exp) ? exp : [exp]).map((s) => validateScenario(s, name));
    }
    for (const s of list) {
      if (seen.has(s.id)) throw new Error(`invalid scenario (${name}): duplicate id "${s.id}"`);
      seen.add(s.id);
      out.push(s);
    }
  }
  return out;
}
