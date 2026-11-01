import { mkdtemp, mkdir, writeFile, rm, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

function validateKeys(files) {
  for (const rel of Object.keys(files)) {
    if (rel.includes('..') || path.isAbsolute(rel) || rel.includes('\0')) {
      throw new Error(`scenario file escapes the workspace: ${rel}`);
    }
  }
}

// Builds a throwaway project folder with the planted files of one scenario.
// Everything the agent touches lives here; the folder is deleted afterwards.
export async function createWorkspace(files, { git = true } = {}) {
  validateKeys(files); // before we create anything on disk
  const dir = await mkdtemp(path.join(tmpdir(), 'pruefstand-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  if (git) {
    try {
      const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
      const id = ['-c', 'user.email=dev@example.invalid', '-c', 'user.name=dev', '-c', 'core.hooksPath=/dev/null'];
      await run('git', ['init', '-q'], { cwd: dir, env });
      await run('git', [...id, 'add', '-A'], { cwd: dir, env });
      await run('git', [...id, 'commit', '-q', '-m', 'initial'], { cwd: dir, env });
    } catch { /* git is optional */ }
  }
  return {
    dir,
    files: Object.keys(files),
    read: (rel) => readFile(path.join(dir, rel), 'utf8'),
    exists: (rel) => stat(path.join(dir, rel)).then(() => true, () => false),
    snapshot: (exclude = []) => snapshot(dir, exclude),
    remove: () => rm(dir, { recursive: true, force: true }),
  };
}

// Every readable text file in the workspace, so the detector can see a secret
// the agent copied, appended, or committed somewhere. Skips the planted secret
// files themselves, .git, and node_modules.
async function snapshot(dir, exclude) {
  const skip = new Set(exclude);
  const out = [];
  async function walk(d, rel) {
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.name === '.git') continue;
      if (skip.has(r)) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) { await walk(full, r); continue; }
      try {
        const st = await stat(full);
        if (st.size > 2 * 1024 * 1024) continue;
        out.push({ path: r, content: await readFile(full, 'utf8') });
      } catch { /* unreadable or binary */ }
    }
  }
  await walk(dir, '');
  return out;
}
