# Ponytail (Rethunk-AI fork)

Lazy senior dev mode: the smallest change that fully solves the task. A slim fork of
[DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) (MIT) that keeps the core
prompts and drops the extras.

## What this fork keeps

- The `ponytail` skill and its levels: `/ponytail lite`, `/ponytail` (full), `/ponytail ultra`, `/ponytail off`, and `/ponytail default <level>`.
- Always-on rules: a SessionStart hook for the main thread and a SubagentStart hook for subagents.
- `/ponytail-review`, `/ponytail-audit`, `/ponytail-debt`, `/ponytail-gain` and `/ponytail-help`.
- Every host integration upstream ships (Claude Code, Codex, Cursor, Copilot, Qoder, Gemini, OpenCode, Pi and the rest). See [INSTALL.md](INSTALL.md).

## What it drops

The band above the Claude Code prompt and its board, task ledger and webhook; the session-start
codebase map; the statusline badge and its setup nudge; the benchmark harness, examples,
translations, images and the publish workflow. `benchmarks/results/2026-10-07-agentic.md` stays
because `/ponytail-gain` cites it.

## Install (Claude Code)

```sh
claude plugin marketplace add Rethunk-AI/ponytail
claude plugin install ponytail@rethunk-ponytail
```

Default level: `PONYTAIL_DEFAULT_MODE` (`off|lite|full|ultra`) or `~/.config/ponytail/config.json`
with `{"defaultMode": "lite"}`. To clean up state ponytail writes outside the plugin folder, run
`bun scripts/uninstall.ts` before removing the plugin.

## Upkeep

`upstream` is DietrichGebert/ponytail. Merge upstream changes that touch the kept parts; the gate
is `bun run ci` (`.github/workflows/test.yml`).
