import { readFile, stat } from 'node:fs/promises';
import { parseReport, compareReports, DiffInputError, LIMITS } from './report/diff.mjs';
import { toText, toMarkdownDiff, toJson } from './report/diff-format.mjs';

export const DIFF_HELP = `pruefstand diff — compare two JSON reports and find regressions

Usage:
  pruefstand diff <alt.json> <neu.json> [options]

Options:
  --format <text|md|json>        Output format            (default: text)
  --fail-on <rueckschritt|nichts> Exit 1 on regressions?  (default: rueckschritt)
  --profil <name>                Compare only this profile
  -h, --help                     Show this help

Reports are the files written by \`pruefstand --json <path>\`.
Exit codes: 0 no regressions (or --fail-on nichts), 1 regressions found,
            2 error in input, format or options.
`;

export function parseDiffArgs(argv) {
  const o = { files: [], format: 'text', failOn: 'rueckschritt', profil: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new DiffInputError(`option ${a} needs a value`); return argv[++i]; };
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--format') o.format = val();
    else if (a === '--fail-on') o.failOn = val();
    else if (a === '--profil') o.profil = val();
    else if (a.startsWith('-') && a !== '-') throw new DiffInputError(`unknown option: ${a}`);
    else o.files.push(a);
  }
  if (o.help) return o;
  if (!['text', 'md', 'json'].includes(o.format)) throw new DiffInputError(`--format must be text, md or json (got "${o.format}")`);
  if (!['rueckschritt', 'nichts'].includes(o.failOn)) throw new DiffInputError(`--fail-on must be rueckschritt or nichts (got "${o.failOn}")`);
  if (o.files.length !== 2) throw new DiffInputError('expected exactly two report files: pruefstand diff <alt> <neu>');
  return o;
}

async function load(file) {
  let st;
  try { st = await stat(file); } catch (e) { throw new DiffInputError(`${file}: cannot read (${e.code ?? e.message})`); }
  if (!st.isFile()) throw new DiffInputError(`${file}: not a file`);
  if (st.size > LIMITS.maxBytes) throw new DiffInputError(`${file}: too large (${st.size} bytes, limit ${LIMITS.maxBytes})`);
  let text;
  try { text = await readFile(file, 'utf8'); } catch (e) { throw new DiffInputError(`${file}: cannot read (${e.code ?? e.message})`); }
  return parseReport(text, file);
}

// Returns the exit code. I/O is injected so it can be tested without a process.
export async function runDiff(argv, { stdout = process.stdout, stderr = process.stderr, env = process.env } = {}) {
  try {
    const o = parseDiffArgs(argv);
    if (o.help) { stdout.write(DIFF_HELP); return 0; }
    const [a, b] = await Promise.all(o.files.map(load));
    const d = compareReports(a, b, { profile: o.profil });
    const color = Boolean(stdout.isTTY) && !('NO_COLOR' in env);
    stdout.write(o.format === 'json' ? toJson(d) : o.format === 'md' ? toMarkdownDiff(d) : toText(d, { color }));
    if (d.unusable) { // a green exit here would be a false all-clear in CI
      stderr.write('pruefstand diff: the reports share no rated cell (no common cells, or only errors/unscored), so nothing was compared. Exit 2.\n');
      return 2;
    }
    return o.failOn === 'rueckschritt' && d.hasRegressions ? 1 : 0;
  } catch (e) {
    if (!(e instanceof DiffInputError)) throw e;
    stderr.write(`pruefstand diff: ${e.message}\n\n${DIFF_HELP}`);
    return 2;
  }
}
