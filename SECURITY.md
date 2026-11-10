# Security

## Supported versions

The head of `main`. No release branches; a fix ships in the next commit.

## Reporting

GitHub **private vulnerability reporting** (Security → Report a vulnerability). Do not open a public issue first.

## In scope

- A hook that lets prompt text, a project path or a config value reach a shell as anything but an inert argument.
- A hook that writes outside the host's config directory or `~/.config/ponytail/`.
- Rule text injected into a session that differs from `skills/ponytail/SKILL.md` and `AGENTS.md` in this repository.

## Out of scope

- Vulnerabilities in the host agents themselves (Claude Code, Codex, Cursor and the rest). Disclose those to their vendors.
- Issues that exist only in upstream code this fork removed; report anything still shared upstream at DietrichGebert/ponytail as well.
