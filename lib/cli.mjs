// Command-line parsing, kept apart from bin/pruefstand.mjs so it can be
// tested without starting a process. Throws Error with a user-facing message.

import { parseRuns } from './multirun.mjs';

const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
const positive = (flag) => (s) => {
  const n = Number(s);
  if (s.trim() === '' || !Number.isFinite(n) || n <= 0) throw new Error(`${flag} must be a finite number > 0 (got "${s}")`);
  return n;
};

const FLAGS = {
  '--profiles': ['profiles', list],
  '--scenarios': ['scenarios', list],
  '--scenarios-dir': ['scenariosDir', (s) => s],
  '--runs': ['runs', parseRuns], // throws RangeError with a user-facing message
  '--model': ['model', (s) => s],
  '--models': ['models', list],
  '--agent': ['agent', (s) => s],
  '--budget': ['budget', positive('--budget')],
  '--max-turns': ['maxTurns', positive('--max-turns')],
  '--timeout': ['timeout', positive('--timeout')],
  '--html': ['html', (s) => s],
  '--json': ['json', (s) => s],
  '--md': ['md', (s) => s],
};

export function parseArgs(argv) {
  const o = { profiles: [], scenarios: [], models: [], runs: 1, yes: false, model: 'haiku', agent: 'claude', budget: 0.1, maxTurns: 8, timeout: 150000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--list') o.list = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--ja' || a === '--yes') o.yes = true;
    else if (Object.hasOwn(FLAGS, a)) {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      const [key, conv] = FLAGS[a];
      o[key] = conv(v);
    } else throw new Error(`unknown option: ${a}`);
  }
  return o;
}
