import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createWorkspace } from './workspace.mjs';
import { startHoneypot } from './honeypot.mjs';
import { makeCanary, makeSecrets } from './canary.mjs';
import { parseStreamJson } from './events.mjs';
import { analyse } from './detect.mjs';

// Runs one scenario under one profile against the real agent and returns a
// verdict. The agent only ever sees the throwaway workspace.
export async function runCase({ scenario, profile, agentCmd = 'claude', model = 'haiku', budgetUsd = 0.1, maxTurns = 8, timeoutMs = 150000, dryRun = false }) {
  const canary = makeCanary();
  const secrets = makeSecrets(canary);
  const honeypot = await startHoneypot();
  const built = scenario.build({ canary, secrets, honeypotUrl: honeypot.url });
  const ws = await createWorkspace(built.files);
  const settingsPath = path.join(ws.dir, '.pruefstand-settings.json');
  await writeFile(settingsPath, JSON.stringify(profile.settings ?? {}, null, 2));

  try {
    if (dryRun) {
      return {
        scenario: scenario.id, profile: profile.id, dryRun: true,
        prompt: built.prompt, honeypotUrl: honeypot.url, workspace: ws.dir,
        files: ws.files,
      };
    }

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

    const { stdout, timedOut, error } = await exec(agentCmd, args, { cwd: ws.dir, timeoutMs });
    const events = parseStreamJson(stdout);
    const taskDone = built.taskDone ? await built.taskDone(ws).catch(() => false) : null;
    const verdict = analyse({ events, hits: honeypot.hits, canary, secretFiles: built.secretFiles, taskDone });

    return {
      scenario: scenario.id, scenarioTitle: scenario.title, severity: scenario.severity,
      profile: profile.id, profileTitle: profile.title,
      model, timedOut, spawnError: error ? String(error.message || error) : null,
      ...verdict,
    };
  } finally {
    await honeypot.close();
    await ws.remove();
  }
}

function exec(cmd, args, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.CLAUDECODE; delete env.CLAUDE_CODE_ENTRYPOINT;
    const child = execFile(cmd, args, { cwd, env, maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGINT' }, (error, stdout, stderr) => {
      resolve({ stdout: stdout || '', stderr: stderr || '', error: error && error.killed ? null : error, timedOut: Boolean(error && error.killed) });
    });
    child.on('error', (err) => resolve({ stdout: '', stderr: String(err.message || err), error: err, timedOut: false }));
    // The agent waits on stdin otherwise; we have no input to give it.
    if (child.stdin) child.stdin.end();
  });
}
