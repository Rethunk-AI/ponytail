#!/usr/bin/env node
// ponytail — shared configuration resolver
//
// Resolution order for default mode:
//   1. PONYTAIL_DEFAULT_MODE environment variable
//   2. Config file defaultMode field:
//      - $XDG_CONFIG_HOME/ponytail/config.json (any platform, if set)
//      - ~/.config/ponytail/config.json (macOS / Linux fallback)
//      - %APPDATA%\ponytail\config.json (Windows fallback)
//   3. 'full'

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  getAppData,
  getClaudeConfigDir,
  getPonytailDefaultMode,
  getPonytailHideStatus,
  getPonytailQuietStartup,
  getQoderConfigDir,
  getXdgConfigHome,
} from './ponytail-env.ts'

const DEFAULT_MODE = 'full'
const VALID_MODES: readonly string[] = ['off', 'lite', 'full', 'ultra', 'review']
const RUNTIME_MODES: readonly string[] = ['off', 'lite', 'full', 'ultra']
const BOM_RE = /^\uFEFF/
const TRAILING_PUNCT_RE = /[.!?\s]+$/
const SHELL_SAFE_RE = /^[A-Za-z0-9 _.\-:/\\~]+$/

interface PonytailConfig {
  defaultMode?: unknown
  quietStartup?: unknown
  hideStatus?: unknown
}

// Strips the UTF-8 BOM (common on Windows-saved files) so JSON.parse doesn't choke.
function readConfigFile(configPath: string): unknown {
  return JSON.parse(fs.readFileSync(configPath, 'utf8').replace(BOM_RE, ''))
}

function isConfigObject(value: unknown): value is PonytailConfig {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readConfig(): PonytailConfig {
  const parsed = readConfigFile(getConfigPath())
  return isConfigObject(parsed) ? parsed : {}
}

function isTruthyFlag(raw: string): boolean {
  const v = raw.trim().toLowerCase()
  return v !== '' && v !== '0' && v !== 'false' && v !== 'no'
}

function normalizeMode(mode: unknown): string | null {
  if (typeof mode !== 'string') {
    return null
  }
  const normalized = mode.trim().toLowerCase()
  return RUNTIME_MODES.includes(normalized) ? normalized : null
}

function normalizeConfigMode(mode: unknown): string | null {
  if (typeof mode !== 'string') {
    return null
  }
  const normalized = mode.trim().toLowerCase()
  return VALID_MODES.includes(normalized) ? normalized : null
}

function normalizePersistedMode(mode: unknown): string | null {
  return normalizeMode(mode) || normalizeConfigMode(mode)
}

// "stop ponytail" / "normal mode" turn ponytail off, but only as a standalone
// command. Matching the phrase anywhere in the message turned it off mid-task
// for ordinary requests like "add a normal mode toggle" — so require the whole
// message to be the command, ignoring case and trailing punctuation.
function isDeactivationCommand(text: unknown): boolean {
  const t = String(text || '')
    .trim()
    .toLowerCase()
    .replace(TRAILING_PUNCT_RE, '')
  return t === 'stop ponytail' || t === 'normal mode'
}

// ponytail: only embed the plugin install path in a shell command when
// it's made of ordinary path characters. An allowlist beats escaping every shell's
// metacharacters; a hostile clone path (quotes, &, $, backtick, ;, etc.) falls back
// to manual setup instead. Allows : \ / for normal Windows and POSIX paths. Full
// per-shell escaper only if a real need appears.
function isShellSafe(p: unknown): boolean {
  return typeof p === 'string' && SHELL_SAFE_RE.test(p)
}

function getConfigDir(): string {
  const xdgConfigHome = getXdgConfigHome()
  if (xdgConfigHome) {
    return path.join(xdgConfigHome, 'ponytail')
  }
  if (process.platform === 'win32') {
    return path.join(getAppData() || path.join(os.homedir(), 'AppData', 'Roaming'), 'ponytail')
  }
  return path.join(os.homedir(), '.config', 'ponytail')
}

function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json')
}

function getClaudeDir(): string {
  // ponytail: CLAUDE_CONFIG_DIR overrides ~/.claude, matching Claude Code.
  return getClaudeConfigDir() || path.join(os.homedir(), '.claude')
}

function getQoderDir(): string {
  return getQoderConfigDir() || path.join(os.homedir(), '.qoder')
}

function getDefaultMode(): string {
  // 1. Environment variable (highest priority)
  // ponytail: a default must be a runtime level (off/lite/full/ultra); review is
  // a session-only mode, never a valid default (#377). Normalize here so values
  // with whitespace or mixed casing still resolve correctly.
  const envMode = normalizeMode(getPonytailDefaultMode())
  if (envMode) {
    return envMode
  }

  // 2. Config file
  try {
    const configMode = normalizeMode(readConfig().defaultMode)
    if (configMode) {
      return configMode
    }
  } catch {
    // Config file doesn't exist or is invalid — fall through
  }

  // 3. Default
  return DEFAULT_MODE
}

// Silence the pi "Ponytail loaded" startup toast while keeping ponytail active.
// PONYTAIL_QUIET_STARTUP=1 (or any truthy value; 0/false/empty mean "show it")
// takes precedence, else config.quietStartup === true. Mirrors getHideStatus.
function getQuietStartup(): boolean {
  const env = getPonytailQuietStartup()
  if (env !== undefined) {
    return isTruthyFlag(env)
  }
  try {
    return readConfig().quietStartup === true
  } catch {
    return false
  }
}

// Hide the status-bar indicator while keeping ponytail active (#324).
// PONYTAIL_HIDE_STATUS=1 (or any truthy value; 0/false/empty mean "don't hide")
// takes precedence, else config.hideStatus === true.
function getHideStatus(): boolean {
  const env = getPonytailHideStatus()
  if (env !== undefined) {
    return isTruthyFlag(env)
  }
  try {
    return readConfig().hideStatus === true
  } catch {
    return false
  }
}

function writeDefaultMode(mode: unknown): string | null {
  // ponytail: only a runtime level can be a default; review is session-only (#377).
  const normalized = normalizeMode(mode)
  if (!normalized) {
    return null
  }

  const configPath = getConfigPath()
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  let config: PonytailConfig = {}
  try {
    config = readConfig()
  } catch (error) {
    // Only a missing file starts fresh: rewriting an unparseable one would drop the user's other settings.
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error
    }
  }
  config.defaultMode = normalized
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
  return normalized
}

export {
  DEFAULT_MODE,
  getClaudeDir,
  getConfigDir,
  getConfigPath,
  getDefaultMode,
  getHideStatus,
  getQoderDir,
  getQuietStartup,
  isDeactivationCommand,
  isShellSafe,
  normalizeConfigMode,
  normalizeMode,
  normalizePersistedMode,
  RUNTIME_MODES,
  VALID_MODES,
  writeDefaultMode,
}
