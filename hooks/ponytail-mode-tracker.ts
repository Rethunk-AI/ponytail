#!/usr/bin/env node
// ponytail — UserPromptSubmit hook to track which ponytail mode is active
// Inspects user input for /ponytail commands and writes mode to flag file

import { getDefaultMode, isDeactivationCommand, writeDefaultMode } from './ponytail-config.ts'
import { getPonytailInstructions } from './ponytail-instructions.ts'
import {
  clearMode,
  cursorRuleNotice,
  cursorRulePath,
  isCodex,
  isCursor,
  isQoder,
  readMode,
  STDIN_FALLBACK_MS,
  setMode,
  writeHookOutput,
} from './ponytail-runtime.ts'

const BOM_RE = /^\uFEFF/
const PONYTAIL_COMMAND_RE = /^[/@$]ponytail/
const WHITESPACE_RE = /\s+/
const SIGIL_RE = /^[@$]/

interface PromptPayload {
  prompt?: unknown
}

interface TurnState {
  modeSwitched: boolean
  deactivated: boolean
  defaultNotice: string
}

interface Switch {
  mode: string | null
  reportOnly: boolean
}

let input = ''
let done = false

function deactivate(state: TurnState): void {
  if (isQoder) {
    setMode('off')
  } else {
    clearMode()
  }
  state.deactivated = true
  writeHookOutput('UserPromptSubmit', 'off', 'PONYTAIL MODE OFF')
}

// `/ponytail default <mode>` persists the default to config (survives
// restarts). Plain switches stay session-scoped ("sticks until session
// end"), so this is the only path that writes config. review is not a
// valid default (#377), so only off/lite/full/ultra are accepted.
function handleDefault(dmode: string | undefined, state: TurnState): void {
  if (dmode === 'off' || dmode === 'lite' || dmode === 'full' || dmode === 'ultra') {
    writeDefaultMode(dmode)
    state.defaultNotice = `PONYTAIL DEFAULT SET — new sessions start in ${dmode}.`
    if (!isQoder) {
      writeHookOutput('UserPromptSubmit', dmode, state.defaultNotice)
    }
  }
}

function resolveSwitch(arg: string): Switch {
  if (arg === 'lite' || arg === 'full' || arg === 'ultra' || arg === 'off') {
    return { mode: arg, reportOnly: false }
  }
  if (arg !== '') {
    return { mode: null, reportOnly: false }
  }
  // Bare /ponytail switches ponytail on: off → the default level (full if
  // the default is off too); already on → keep the level, report it (#639).
  const live = readMode()
  if (live && live !== 'off') {
    return { mode: live, reportOnly: true }
  }
  const defaultMode = getDefaultMode()
  return { mode: defaultMode === 'off' ? 'full' : defaultMode, reportOnly: false }
}

function applySwitch(mode: string, state: TurnState): void {
  setMode(mode)
  state.modeSwitched = true
  // ponytail: Qoder needs the full ruleset every turn, so when a mode
  // switch happens we fold the confirmation into the ruleset output
  // below (one JSON on stdout) instead of emitting two separate writes.
  if (isQoder) {
    return
  }
  // Cursor (#817) and Codex have no /ponytail command that would load
  // the skill body for the new level, and the SessionStart ruleset is
  // filtered to the start level, so the tracker delivers that level's
  // ruleset along with the confirmation.
  const header = `PONYTAIL MODE CHANGED — level: ${mode}`
  writeHookOutput(
    'UserPromptSubmit',
    mode,
    isCodex || isCursor ? `${header}\n\n${getPonytailInstructions(mode)}` : header,
  )
}

// Returns true when the prompt is fully handled and nothing else should run.
function handlePonytailCommand(prompt: string, state: TurnState): boolean {
  const parts = prompt.split(WHITESPACE_RE)
  const cmd = (parts[0] ?? '').replace(SIGIL_RE, '/')
  // /ponytail-review is a one-shot skill, not a session level (#736).
  // Matching it here used to setMode('review'), which latched
  // INDEPENDENT_MODES for the rest of the session.
  if (cmd !== '/ponytail' && cmd !== '/ponytail:ponytail') {
    return false
  }
  const arg = parts[1] ?? ''
  if (arg === 'default') {
    handleDefault(parts[2], state)
    // Qoder still needs this turn's ruleset: the Qoder step folds the notice
    // into it. mode stays null, so the session level is untouched.
    return !isQoder
  }
  const { mode, reportOnly } = resolveSwitch(arg)
  if (mode === null) {
    return false
  }
  if (reportOnly) {
    // On Qoder the ruleset block already reports; a second write
    // here would put two JSON objects on stdout.
    if (!isQoder) {
      writeHookOutput('UserPromptSubmit', mode, `PONYTAIL MODE ACTIVE — level: ${mode}`)
    }
  } else if (mode === 'off') {
    deactivate(state)
  } else {
    applySwitch(mode, state)
  }
  return false
}

// Qoder has no SessionStart event, so UserPromptSubmit does double duty:
// activate the default mode on first prompt (if no flag exists yet), then
// inject the ruleset on every prompt. Claude Code/Codex do this in
// SessionStart via ponytail-activate.ts; Qoder can't, so we do it here.
function handleQoder(state: TurnState): void {
  let currentMode = readMode()
  if (!currentMode) {
    // First prompt in session — initialize from config/env default
    currentMode = getDefaultMode()
    if (currentMode !== 'off') {
      try {
        setMode(currentMode)
      } catch {
        // Flag is best-effort; the ruleset is still injected below
      }
    }
  }
  if (currentMode !== 'off') {
    // ponytail: one JSON per invocation — mode-switch confirmation is
    // folded into the ruleset header so Qoder gets both in one write.
    const header =
      (state.defaultNotice ? `${state.defaultNotice}\n\n` : '') +
      (state.modeSwitched ? `PONYTAIL MODE CHANGED — level: ${currentMode}\n\n` : '')
    writeHookOutput('UserPromptSubmit', currentMode, header + getPonytailInstructions(currentMode))
  } else if (state.defaultNotice) {
    writeHookOutput('UserPromptSubmit', currentMode, state.defaultNotice)
  }
}

function handlePrompt(prompt: string): void {
  // Cursor with the always-on rule in the workspace: no hook can change or
  // switch off a rule, so answer the command with the notice instead of
  // writing a mode the rule would contradict (#817). Ordinary prompts
  // stay silent as usual.
  const isCommand = PONYTAIL_COMMAND_RE.test(prompt)
  if (isCursor && (isCommand || isDeactivationCommand(prompt))) {
    const rule = cursorRulePath()
    if (rule) {
      writeHookOutput('UserPromptSubmit', readMode() || 'off', cursorRuleNotice(rule))
      return
    }
  }

  const state: TurnState = { modeSwitched: false, deactivated: false, defaultNotice: '' }
  if (isCommand && handlePonytailCommand(prompt, state)) {
    return
  }

  if (!(state.modeSwitched || state.deactivated) && isDeactivationCommand(prompt)) {
    deactivate(state)
  }

  // Skip when deactivated — user just turned ponytail off.
  if (isQoder && !state.deactivated) {
    handleQoder(state)
  }
}

function finish(): void {
  if (done) {
    return
  }
  done = true
  try {
    // Strip UTF-8 BOM some shells prepend when piping (breaks JSON.parse)
    const data: PromptPayload = JSON.parse(input.replace(BOM_RE, ''))
    handlePrompt(
      String(data.prompt || '')
        .trim()
        .toLowerCase(),
    )
  } catch {
    // Silent fail
  }
}

process.stdin.on('data', (chunk) => {
  input += chunk
})
// Exit on 'end', not just finish(): the fallback timer below must stay ref'd
// (see #790) so it can actually fire when stdin is stuck, and a ref'd timer
// would otherwise keep the process alive for its full 1000ms on this normal
// fast path.
process.stdin.on('end', () => {
  finish()
  process.exit(0)
})

// Never hang the session. On Windows, Claude Code runs this hook through a
// PowerShell `if {}` wrapper that can swallow the piped prompt JSON, so stdin
// 'end' never fires and the hook blocks forever — freezing the session (#443).
// On error, or after a short fallback, process whatever arrived (recovering the
// mode if data came without EOF) and exit. The fallback timer MUST stay ref'd:
// on Windows a stuck ref'd stdin handle keeps the event loop alive, and an
// unref'd timer competing with it is never scheduled — so the fallback was
// dead code in exactly the #443/#790 case it exists for, and the hook hung
// until Claude Code's external 5s watchdog killed it (#790). Mirrors the
// best-effort, never-block contract the other lifecycle hooks already follow.
process.stdin.on('error', () => {
  finish()
  process.exit(0)
})
setTimeout(() => {
  finish()
  process.exit(0)
}, STDIN_FALLBACK_MS)
