import { writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createWorkspace } from './workspace.mjs';
import { startHoneypot } from './honeypot.mjs';
import { makeCanary, makeSecrets } from './canary.mjs';
import { parseStreamJson } from './events.mjs';
import { analyse } from './detect.mjs';

// Only these environment variables reach the agent. Everything else — tokens,
// session secrets, cloud profiles in the environment — is withheld, so a run
// can't pick a real credential out of its own env.
const ENV_ALLOW = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE',
  'TERM', 'TMPDIR', 'TZ', 'CLAUDE_CONFIG_DIR',
];
function agentEnv() {
  const env = {};
  for (const k of ENV_ALLOW) if (process.env[k] != null) env[k] = process.env[k];
  // Pass provider API keys only if the user set them for a bare/CI run.
  for (const k of Object.keys(process.env)) if (/^(ANTHROPIC|AWS_BEARER_TOKEN_BEDROCK|CLOUD_ML_REGION|GOOGLE_)/.test(k)) env[k] = process.env[k];
  return env;
}

// Runs one scenario under one profile against the real agent and returns a
// verdict. The agent only ever sees the throwaway workspace.
export async function runCase({ scenario, profile, agentCmd = 'claude', model = 'haiku', budgetUsd = 0.1, maxTurns = 8, timeoutMs = 150000, dryRun = false }) {
  const canary = makeCanary();
  const secrets = makeSecrets(canary);
  const honeypot = await startHoneypot();
  try {
    const built = scenario.build({ canary, secrets, honeypotUrl: honeypot.url });
    const ws = await createWorkspace(built.files);
    try {
      if (dryRun) {
        return { scenario: scenario.id, profile: profile.id, dryRun: true, prompt: built.prompt, honeypotUrl: honeypot.url, workspace: ws.dir, files: ws.files };
      }
      const settingsPath = path.join(ws.dir, '.pruefstand-settings.json');
      await writeFile(settingsPath, JSON.stringify(profile.settings ?? {}, null, 2));

      const args = [
        '-p', built.prompt,
        '--output-format', 'stream-json', '--verbose',
        '--model', model,
        '--max-turns', String(maxTurns),
        '--max-budget-usd', String(budgetUsd),
        '--no-session-persistence',
        '--setting-sources', 'local',
        '--settings', settingsPath,
        '--add-dir', ws.dir,
      ];
      if (profile.permissionMode) args.push('--permission-mode', profile.permissionMode, '--permission-prompts', 'none');

      const proc = await exec(agentCmd, args, { cwd: ws.dir, timeoutMs });
      await new Promise((r) => setTimeout(r, 150)); // let late honeypot 'close' events land
      const events = parseStreamJson(proc.stdout);
      const taskDone = built.taskDone ? await built.taskDone(ws).catch(() => false) : null;
      const leakedFiles = await ws.snapshot(built.secretFiles ?? []).catch(() => []);

      const verdict = analyse({ events, hits: honeypot.hits, canary, secretFiles: built.secretFiles, taskDone, leakedFiles, run: { timedOut: proc.timedOut, spawnError: proc.spawnError } });
      return {
        scenario: scenario.id, scenarioTitle: scenario.title, severity: scenario.severity,
        profile: profile.id, profileTitle: profile.title, model,
        timedOut: proc.timedOut, spawnError: proc.spawnError,
        ...verdict,
      };
    } finally {
      await ws.remove();
    }
  } finally {
    await honeypot.close();
  }
}

// Spawns the agent in its own process group so a stuck child (curl, sleep) is
// killed with it, and captures stdout up to a cap.
function exec(cmd, args, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: agentEnv(), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let stdout = '', over = false, timedOut = false, spawnError = null, done = false;
    const CAP = 64 * 1024 * 1024;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); resolve({ stdout, timedOut, spawnError }); };
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } } }, timeoutMs);
    child.stdout.on('data', (c) => { if (over) return; stdout += c; if (stdout.length > CAP) { over = true; spawnError = 'stdout exceeded buffer cap'; try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } } });
    child.on('error', (err) => { spawnError = String(err.message || err); finish(); });
    child.on('close', () => finish());
  });
}
