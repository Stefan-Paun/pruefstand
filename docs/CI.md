# Running pruefstand in CI

The unit tests (`npm test`) run anywhere and need no agent or network.

The live bench calls `claude -p`, which needs credentials. On your own machine
a logged-in Claude Code is enough. In CI there is no interactive login, so set
an API key and start the agent in bare mode, which reads `ANTHROPIC_API_KEY`
instead of the keychain:

```bash
export ANTHROPIC_API_KEY=...        # from a CI secret
node bin/pruefstand.mjs --model haiku --json berichte/ci.json
```

Treat the live bench as a scheduled or manual job, not a per-commit gate: each
run spends a few cents of API budget.
