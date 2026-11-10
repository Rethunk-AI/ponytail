#!/usr/bin/env bun
// ponytail — install or remove the Cursor hooks (hooks/cursor-hooks.json) in
// ~/.cursor/hooks.json (default) or <cwd>/.cursor/hooks.json (--project),
// merging with whatever hooks are already there. Only entries that run one of
// ponytail's own hooks/ponytail-*.ts scripts are added or removed; every other
// hook stays as it was.
//
//   bun scripts/cursor-hooks.ts install [--project]
//   bun scripts/cursor-hooks.ts uninstall [--project]

import fs from 'node:fs'

import os from 'node:os'
import path from 'node:path'
import { isShellSafe } from '../hooks/ponytail-config.ts'

const ROOT = path.join(import.meta.dirname, '..')
const TEMPLATE = path.join(ROOT, 'hooks', 'cursor-hooks.json')
const BOM_RE = /^\uFEFF/
const BACKSLASH_RE = /\\/g
const PLACEHOLDER_RE = /PONYTAIL_DIR/g
const JSON_INDENT = 2
const PONYTAIL_HOOK = /[\\/]hooks[\\/]ponytail-[\w-]+\.ts(?=["'\s]|$)/

type Scope = 'project' | 'user'

interface HookEntry {
  command?: unknown
  [key: string]: unknown
}

interface HooksConfig {
  version?: unknown
  hooks: Record<string, HookEntry[]>
  [key: string]: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isErrnoException(e: unknown): e is NodeJS.ErrnoException {
  return e instanceof Error && 'code' in e
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function isPonytailHook(entry: unknown): boolean {
  return isRecord(entry) && typeof entry.command === 'string' && PONYTAIL_HOOK.test(entry.command)
}

function hooksPath(scope: Scope): string {
  return scope === 'project'
    ? path.join(process.cwd(), '.cursor', 'hooks.json')
    : path.join(os.homedir(), '.cursor', 'hooks.json')
}

// Missing file → empty config. Malformed JSON throws a SyntaxError so the
// caller can refuse to touch the file rather than overwrite it.
function readConfig(file: string): HooksConfig {
  let parsed: unknown = {}
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(BOM_RE, ''))
  } catch (e) {
    if (!(isErrnoException(e) && e.code === 'ENOENT')) {
      throw e
    }
  }
  if (!isRecord(parsed)) {
    throw new Error(`${file} must contain a JSON object; nothing was changed`)
  }
  const rawHooks = parsed.hooks ?? {}
  if (!isRecord(rawHooks)) {
    throw new Error(`${file}: hooks must be an object; nothing was changed`)
  }
  const hooks: Record<string, HookEntry[]> = {}
  for (const [event, entries] of Object.entries(rawHooks)) {
    if (!Array.isArray(entries)) {
      throw new Error(`${file}: hooks.${event} must be an array; nothing was changed`)
    }
    hooks[event] = entries
  }
  return { ...parsed, hooks }
}

function writeConfig(file: string, config: HooksConfig): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(config, null, JSON_INDENT)}\n`, 'utf8')
}

// The template's PONYTAIL_DIR placeholder becomes this checkout's absolute
// path. Forward slashes run unchanged under cmd, PowerShell and bash, and the
// isShellSafe allowlist keeps shell metacharacters out of the command string.
function ponytailEntries(): Record<string, HookEntry[]> {
  const root = ROOT.replace(BACKSLASH_RE, '/')
  if (!isShellSafe(root)) {
    throw new Error(
      'ponytail is checked out at a path with shell metacharacters (' +
        ROOT +
        '); move it, or copy hooks/cursor-hooks.json by hand and quote the path for your shell',
    )
  }
  const template: { hooks: Record<string, { command: string }[]> } = JSON.parse(
    fs.readFileSync(TEMPLATE, 'utf8'),
  )
  const hooks: Record<string, HookEntry[]> = {}
  for (const [event, entries] of Object.entries(template.hooks)) {
    hooks[event] = entries.map((entry) => ({
      ...entry,
      command: entry.command.replace(PLACEHOLDER_RE, root),
    }))
  }
  return hooks
}

function stripPonytail(config: HooksConfig): void {
  for (const [event, entries] of Object.entries(config.hooks)) {
    const kept = entries.filter((entry) => !isPonytailHook(entry))
    if (kept.length) {
      config.hooks[event] = kept
    } else {
      delete config.hooks[event]
    }
  }
}

function install(scope: Scope): string {
  const file = hooksPath(scope)
  const config = readConfig(file)
  if (config.version === undefined) {
    config.version = 1
  }
  // Re-running replaces stale ponytail entries instead of duplicating them.
  stripPonytail(config)
  for (const [event, entries] of Object.entries(ponytailEntries())) {
    config.hooks[event] = [...(config.hooks[event] ?? []), ...entries]
  }
  writeConfig(file, config)
  return file
}

// Returns the file it changed, or null when there was nothing of ponytail's in it.
function uninstall(scope: Scope): string | null {
  const file = hooksPath(scope)
  if (!fs.existsSync(file)) {
    return null
  }
  const config = readConfig(file)
  const before = JSON.stringify(config)
  stripPonytail(config)
  if (JSON.stringify(config) === before) {
    return null
  }
  const otherKeys = Object.keys(config).filter((k) => k !== 'version' && k !== 'hooks')
  if (Object.keys(config.hooks).length === 0 && otherKeys.length === 0) {
    // Only ponytail lived here: drop the file rather than leave an empty husk.
    fs.unlinkSync(file)
  } else {
    writeConfig(file, config)
  }
  return file
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const action = args[0]
  const scope: Scope = args.includes('--project') ? 'project' : 'user'
  try {
    if (action === 'install') {
      const file = install(scope)
      console.log(`Installed ponytail hooks in ${file}`)
      console.log('Cursor reloads hooks.json on save; start a new chat to activate.')
    } else if (action === 'uninstall') {
      const file = uninstall(scope)
      console.log(
        file ? `Removed ponytail hooks from ${file}` : `No ponytail hooks in ${hooksPath(scope)}`,
      )
    } else {
      console.error('usage: bun scripts/cursor-hooks.ts install|uninstall [--project]')
      process.exit(1)
    }
  } catch (e) {
    if (e instanceof SyntaxError) {
      console.error(
        hooksPath(scope) +
          ' is not valid JSON; nothing was changed, fix it by hand (' +
          e.message +
          ')',
      )
    } else {
      console.error(errorMessage(e))
    }
    process.exit(1)
  }
}

export { hooksPath, install, isPonytailHook, uninstall }
