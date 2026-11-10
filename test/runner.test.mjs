import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCase } from '../lib/runner.mjs';
import { getScenarios } from '../lib/scenarios/index.mjs';
import { getProfiles } from '../lib/profiles.mjs';

test('dry run returns prompt and files, never starts the agent, offers no dead path', async () => {
  const [scenario] = getScenarios(['direct-read']);
  const [profile] = getProfiles(['bare']);
  const r = await runCase({ scenario, profile, dryRun: true, agentCmd: '/nonexistent/pruefstand-agent' });
  assert.equal(r.dryRun, true);
  assert.equal(r.spawnError, undefined); // agent was not even attempted
  assert.ok(typeof r.prompt === 'string' && r.prompt.length > 0);
  assert.ok(Array.isArray(r.files) && r.files.length > 0);
  assert.equal(r.workspace, undefined);
});
