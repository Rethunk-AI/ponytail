<h1 align="center">Ponytail (Rethunk-AI fork)</h1>

<div align="center">

[![CI](https://img.shields.io/github/actions/workflow/status/Rethunk-AI/ponytail/test.yml?branch=main)](https://github.com/Rethunk-AI/ponytail/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/github/license/Rethunk-AI/ponytail)](LICENSE)

</div>

---

Lazy senior dev mode: the smallest change that fully solves the task. This is a
fork of [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail)
(MIT) that keeps the core prompts and drops the extras.

## Quick start

```sh
claude plugin marketplace add Rethunk-AI/ponytail
claude plugin install ponytail@rethunk-ponytail
```

Per-agent install, settings, and uninstall: [HUMANS.md](HUMANS.md).

## Highlights

- The `ponytail` skill and its levels: `/ponytail lite`, `/ponytail` (full), `/ponytail ultra`, `/ponytail off`, and `/ponytail default <level>`.
- Always-on rules: a SessionStart hook for the main thread and a SubagentStart hook for subagents.
- `/ponytail-review`, `/ponytail-audit`, `/ponytail-debt`, `/ponytail-gain` and `/ponytail-help`.
- Host integrations for Claude Code, Codex, Cursor, Copilot, Qoder, Gemini, OpenCode, Pi and others. Per-agent steps live in [HUMANS.md](HUMANS.md) and [INSTALL.md](INSTALL.md).

The band above the Claude Code prompt and its board, task ledger and webhook; the session-start
codebase map; the statusline badge and its setup nudge; the benchmark harness, examples,
translations, images and the publish workflow are not in this fork.
`benchmarks/results/2026-10-07-agentic.md` stays because `/ponytail-gain` cites it.

`upstream` is DietrichGebert/ponytail. Merge upstream changes that touch the kept parts.
The check for this repo is `bun run ci` (`.github/workflows/test.yml`).

## Documentation

| Doc                        | What                                        |
| -------------------------- | ------------------------------------------- |
| [HUMANS.md](HUMANS.md)     | Install, settings, usage, verify, uninstall |
| [AGENTS.md](AGENTS.md)     | The ruleset injected into sessions          |
| [INSTALL.md](INSTALL.md)   | Per-agent install commands                  |
| [SECURITY.md](SECURITY.md) | How to report a vulnerability               |
| [LICENSE](LICENSE)         | MIT license text                            |

## License

MIT. Copyright (c) 2026 DietrichGebert. See [LICENSE](LICENSE).
