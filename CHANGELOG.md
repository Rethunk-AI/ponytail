# Changelog

All notable changes to this fork are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow
upstream [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail); fork changes are
listed under the upstream version they apply to.

## [Unreleased]

### Changed

- Hooks, scripts, tests and host plugins are TypeScript run by Bun; the gate is `bun run ci`.
- Marketplaces are named `rethunk-ponytail`.

### Removed

- The Claude Code band above the prompt, its board, task ledger and webhook.
- The session-start codebase map.
- The statusline badge and its setup nudge.
- The benchmark harness, examples, translations, images and the publish workflow.
