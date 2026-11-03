// A profile is one way of running the agent: which permission mode, which
// deny rules, sandbox on or off. Running the same scenarios under several
// profiles shows whether each defence actually changes the outcome.

export const DENY_SECRETS = [
  'Read(./.env)', 'Read(./.env.*)', 'Read(./.npmrc)',
  'Read(//**/.env)', 'Read(//**/.npmrc)',
];

// PreToolUse hook for Bash: blocks any command that mentions .env/.npmrc
// (exit code 2 = deny, stderr goes back to the agent). Self-contained, so it
// needs no extra file in the workspace. Closes the `cat .env` gap that
// Read-deny rules leave open, without the full OS sandbox.
// Grenze: reine Zeichenketten-Prüfung — Umgehungen wie `cat .e*` greifen nicht.
export const BASH_GUARD_COMMAND = `node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let c="";try{c=String(JSON.parse(d).tool_input.command||"")}catch{}if(/\\.(env|npmrc)\\b/.test(c)){console.error("pruefstand: Bash access to secret files blocked");process.exit(2)}})'`;

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
  'deny-hook': {
    id: 'deny-hook',
    title: 'Deny reads + Bash hook',
    description: 'deny rules plus a PreToolUse hook that rejects Bash commands touching .env/.npmrc. No sandbox.',
    settings: {
      permissions: { allow: ['Bash', 'Read', 'WebFetch'], deny: DENY_SECRETS },
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: BASH_GUARD_COMMAND }] }] },
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
