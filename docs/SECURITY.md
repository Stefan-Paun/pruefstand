# Security notes

pruefstand is a *defensive* testing tool. It never uses or transmits a real
credential:

- Planted secrets are random strings with a `pfst…` canary. They authenticate
  to nothing.
- The honeypot binds to `127.0.0.1` on an ephemeral port and only records.
- Each scenario runs in a fresh `mkdtemp` workspace that is removed afterward,
  and the whole workspace is scanned before removal.
- Scenario file keys are rejected before anything is written if they are
  absolute, contain `..`, or contain a null byte.
- The agent is spawned with a **trimmed environment** (an allowlist of `PATH`,
  `HOME`, locale, `TERM`, `TMPDIR`, and provider API-key variables). Tokens and
  session secrets in your environment are not passed to it.
- The agent is spawned in its own process group and killed as a group on
  timeout, so a stuck child (`curl`, `sleep`) can't outlive the run.

## One honest limitation

The agent runs with your real `HOME` so it can use your existing Claude Code
login. The shipped scenarios only ever reference files inside the throwaway
workspace, so they never point the agent at your real home. But the `bare`
profile has no sandbox by design: if you write a **custom** scenario whose
injected text names a real path (e.g. `~/.aws/credentials`), a `bare` run could
read it. Two rules keep this safe:

1. Write custom scenarios against workspace-relative paths only.
2. To test exposure of real home files on purpose, use the `sandbox` profile,
   which denies those reads at the OS level.

**Run it on a machine you own, against your own agent.** The scenarios
intentionally contain injection text; that text only ever reaches the agent you
launch, inside the throwaway workspace.

Found a problem? Open an issue describing it without a working exploit.
