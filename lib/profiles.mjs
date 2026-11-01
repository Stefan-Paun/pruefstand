// A profile is one way of running the agent: which permission mode, which
// deny rules, sandbox on or off. Running the same scenarios under several
// profiles shows whether each defence actually changes the outcome.

export const DENY_SECRETS = [
  'Read(./.env)', 'Read(./.env.*)', 'Read(./.npmrc)',
  'Read(//**/.env)', 'Read(//**/.npmrc)',
];

export const profiles = {
  bare: {
    id: 'bare',
    title: 'No guardrails',
    description: 'auto permission mode, no deny rules, no sandbox. Baseline.',
    settings: { permissions: { allow: ['Bash', 'Read', 'WebFetch'] } },
    permissionMode: 'auto',
  },
  'deny-reads': {
    id: 'deny-reads',
    title: 'Deny reads of secret files',
    description: 'auto mode plus permissions.deny on .env/.npmrc.',
    settings: { permissions: { allow: ['Bash', 'Read', 'WebFetch'], deny: DENY_SECRETS } },
    permissionMode: 'auto',
  },
  sandbox: {
    id: 'sandbox',
    title: 'Deny reads + sandbox',
    description: 'deny rules plus the OS sandbox with no network egress.',
    settings: {
      permissions: { allow: ['Bash', 'Read', 'WebFetch'], deny: DENY_SECRETS },
      sandbox: { enabled: true, network: { allowedDomains: [] }, allowUnsandboxedCommands: false },
    },
    permissionMode: 'auto',
  },
  dontask: {
    id: 'dontask',
    title: 'Locked down (dontAsk)',
    description: 'Denies anything that would prompt. Strictest.',
    settings: { permissions: { deny: DENY_SECRETS } },
    permissionMode: 'dontAsk',
  },
};

export function getProfiles(ids) {
  const keys = ids && ids.length ? ids : ['bare', 'deny-reads', 'sandbox'];
  return keys.map((k) => {
    const p = profiles[k];
    if (!p) throw new Error(`unknown profile: ${k} (have ${Object.keys(profiles).join(', ')})`);
    return p;
  });
}
