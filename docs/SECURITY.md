# Security notes

pruefstand is a *defensive* testing tool. It never uses or transmits a real
credential:

- Planted secrets are random strings with a `pfst…` canary. They authenticate
  to nothing.
- The honeypot binds to `127.0.0.1` on an ephemeral port and only records.
- Each scenario runs in a fresh `mkdtemp` workspace that is removed afterward.
- Scenario file keys are rejected if they are absolute or contain `..`.

**Run it on a machine you own, against your own agent.** The scenarios
intentionally contain injection text; that text only ever reaches the agent you
launch, inside the throwaway workspace.

Found a problem? Open an issue describing it without a working exploit.
