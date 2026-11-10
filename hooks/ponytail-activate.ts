#!/usr/bin/env node
// ponytail — Claude Code SessionStart activation hook (also Codex, Copilot,
// Grok, CodeBuddy and Cursor sessionStart)
//
// Runs on every session start:
//   1. Writes flag file at $CLAUDE_CONFIG_DIR/.ponytail-active (defaults to ~/.claude)
//   2. Emits ponytail ruleset as hidden SessionStart context

import { getDefaultMode } from './ponytail-config.ts'

import { getPonytailInstructions } from './ponytail-instructions.ts'

import {
  clearMode,
  cursorRuleNotice,
  cursorRulePath,
  isCursor,
  readMode,
  STDIN_FALLBACK_MS,
  setMode,
  writeHookOutput,
} from './ponytail-runtime.ts'

const BOM_RE = /^\uFEFF/

interface SessionStartPayload {
  source?: unknown
}

function activate(mode: string): void {
  // "off" mode — skip activation entirely, don't write flag or emit rules
  if (mode === 'off') {
    clearMode()
    process.exit(0)
  }

  // Cursor with the always-on rule in the workspace: the rule already carries the
  // ruleset and would contradict any other level, so leave the flag alone and
  // hand the model a one-line notice instead of a second copy (#817).
  if (isCursor) {
    const rule = cursorRulePath()
    if (rule) {
      try {
        writeHookOutput('SessionStart', mode, cursorRuleNotice(rule))
      } catch {
        // Silent fail — stdout closed/EPIPE at hook exit must not surface as a hook failure
      }
      process.exit(0)
    }
  }

  // 1. Write flag file
  try {
    setMode(mode)
  } catch {
    // Silent fail -- flag is best-effort, don't block the hook
  }

  // 2. Emit the ponytail ruleset, filtered to the active intensity level.
  const output = getPonytailInstructions(mode)

  try {
    writeHookOutput('SessionStart', mode, output)
  } catch {
    // Silent fail — stdout closed/EPIPE at hook exit must not surface as a hook failure
  }
}

// Compaction re-runs SessionStart inside the same conversation, so it keeps the
// live level (or stays off after "stop ponytail") instead of resetting to the
// default. Claude Code and Codex pass the trigger as `source` on stdin; reading
// it there keeps the hook entry, and the trust Codex gave it, unchanged.
let input = ''
let done = false

function finish() {
  if (done) {
    return
  }
  done = true
  let source: unknown = ''
  try {
    // Strip UTF-8 BOM some shells prepend when piping (breaks JSON.parse)
    const payload: SessionStartPayload = JSON.parse(input.replace(BOM_RE, ''))
    source = payload.source
  } catch {
    // No payload, or an unparseable one: treat it as a fresh session
  }
  activate(source === 'compact' ? readMode() || 'off' : getDefaultMode())
}

process.stdin.on('data', (chunk) => {
  input += chunk
})
// Never hang the session start (#443, #790): like the mode tracker, recover on a
// stdin error or after a short ref'd fallback, and start at the default level.
process.stdin.on('end', () => {
  finish()
  process.exit(0)
})
process.stdin.on('error', () => {
  finish()
  process.exit(0)
})
setTimeout(() => {
  finish()
  process.exit(0)
}, STDIN_FALLBACK_MS)
