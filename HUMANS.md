# HUMANS

Install, settings, usage, and uninstall for ponytail. Per-agent command lists
live in [INSTALL.md](INSTALL.md).

## Quick start

The Claude Code, Codex, Copilot, Qoder and Cursor hooks are TypeScript run by
[Bun](https://bun.sh). Put `bun` on the non-interactive shell PATH. Without it
the skills still work; hook calls print `bun: command not found`.

Claude Code (CLI):

```sh
claude plugin marketplace add Rethunk-AI/ponytail
claude plugin install ponytail@rethunk-ponytail
```

In a Claude Code session the same two steps are `/plugin marketplace add Rethunk-AI/ponytail`
then `/plugin install ponytail@rethunk-ponytail` (send them as two prompts).

Other hosts (Codex, Copilot CLI, Pi, Kimi, OpenCode, Gemini, Qoder, Cursor,
Hermes, and the rest): [INSTALL.md](INSTALL.md). Which files map to which
agent: [docs/agent-portability.md](docs/agent-portability.md).

Most agents that are not listed still read [AGENTS.md](AGENTS.md): copy it into
the project, or install [skills/ponytail/SKILL.md](skills/ponytail/SKILL.md) as a
skill.

## Settings

Set the level for every new session with `PONYTAIL_DEFAULT_MODE`
(`lite` / `full` / `ultra` / `off`), or a `defaultMode` field in
`~/.config/ponytail/config.json` (`%APPDATA%\ponytail\config.json` on Windows).
The default is `full`.

While active, the ruleset is also injected into every subagent spawned via the
Agent tool. To scope that to specific agent types, set `PONYTAIL_SUBAGENT_MATCHER`
to a regex tested against the subagent's `agent_type`. It is unanchored and
case-insensitive. Unset means inject into every subagent; an invalid regex, or a
subagent whose type the platform does not report, also falls back to injecting.

## Usage

After install, a new session should see `/ponytail`, `/ponytail-review`,
`/ponytail-audit`, `/ponytail-debt`, `/ponytail-gain` and `/ponytail-help`.
`/ponytail-help` is the check that the plugin loaded.

Host-specific command spellings (Copilot CLI namespaces, Hermes slash commands,
Skills CLI) are in [INSTALL.md](INSTALL.md) and [after-install.md](after-install.md).

## Verify

In an agent session, run `/ponytail-help`. You should get the help card for the
six commands.

This repository's own check is `bun run ci` (lint, typecheck, knip, rule-copy
and version guards, then `bun test`). CI runs that same script from
`.github/workflows/test.yml`.

## Uninstall

Host remove commands are in [INSTALL.md](INSTALL.md) under Uninstall. They leave
state ponytail writes outside the plugin folder: the mode flag
(`~/.claude/.ponytail-active`, or `~/.cursor/.ponytail-active` for Cursor),
`~/.config/ponytail/config.json`, and ponytail's entries in
`~/.cursor/hooks.json`.

Run `bun scripts/uninstall.ts` to clean those up. Run it before the host remove
command: the script is a plugin file, so removing the plugin first deletes it
(or run it from a separate clone of this repo).
