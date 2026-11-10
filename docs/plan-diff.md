# Plan: `pruefstand diff`

Goal: compare two JSON reports (`--json` output) and tell whether protection got
worse; exit code usable in CI.

## Stages
1. **Core module** `lib/report/diff.mjs` (pure): strict report validation
   (`parseReport`), `compareReports` with categories regression / improvement /
   unchanged / new / dropped, per-profile summary, comparability warnings.
   Tests: `test/diff.test.mjs`.
2. **Formatters** `lib/report/diff-format.mjs`: text (table, colour only on
   TTY and without `NO_COLOR`), Markdown (escaped), JSON.
   Tests: `test/diff-format.test.mjs`.
3. **CLI** `lib/diff-cli.mjs` + dispatch in `bin/pruefstand.mjs`: option parsing,
   size-limited file reading, exit codes 0/1/2. Tests run the CLI as child process
   (`test/diff-cli.test.mjs`).
4. **Docs**: README section, `examples/diff-workflow.yml` (documentation only,
   not under `.github/workflows`).

## Noise rule
Cells are matched on scenario id + profile; several runs per cell are pooled.
Error runs are ignored. A change counts only if the held-rate difference exceeds
2 standard errors (adjusted proportions (h+0.5)/(n+1)); otherwise "unchanged
(within noise)". Single measurements always carry a warning.

## Not included
No measurement run, no posting, no changes to existing reports or to the
scoring in `benchmark.mjs`.
