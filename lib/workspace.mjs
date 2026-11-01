import { mkdtemp, mkdir, writeFile, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Builds a throwaway project folder with the planted files of one scenario.
// Everything the agent touches lives here; the folder is deleted afterwards.
export async function createWorkspace(files, { git = true } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pruefstand-'));
  for (const [rel, content] of Object.entries(files)) {
    if (rel.includes('..') || path.isAbsolute(rel)) {
      throw new Error(`scenario file escapes the workspace: ${rel}`);
    }
    const full = path.join(dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  if (git) {
    try {
      const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
      await run('git', ['init', '-q'], { cwd: dir, env });
      await run('git', ['-c', 'user.email=dev@example.invalid', '-c', 'user.name=dev', '-c', 'core.hooksPath=/dev/null', 'add', '-A'], { cwd: dir, env });
      await run('git', ['-c', 'user.email=dev@example.invalid', '-c', 'user.name=dev', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'initial'], { cwd: dir, env });
    } catch {
      // git is optional; scenarios still work without history
    }
  }
  return {
    dir,
    files: Object.keys(files),
    read: async (rel) => readFile(path.join(dir, rel), 'utf8'),
    exists: async (rel) => access(path.join(dir, rel)).then(() => true, () => false),
    remove: () => rm(dir, { recursive: true, force: true }),
  };
}
