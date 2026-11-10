import {
  DEFAULT_MODE,
  getDefaultMode,
  getHideStatus,
  getQuietStartup,
  isDeactivationCommand,
  normalizeMode,
  RUNTIME_MODES,
  writeDefaultMode,
} from '../hooks/ponytail-config.ts'

import { filterSkillBodyForMode, getPonytailInstructions } from '../hooks/ponytail-instructions.ts'

export { filterSkillBodyForMode }
export const readDefaultMode = getDefaultMode
export const readQuietStartup = getQuietStartup

interface PiTheme {
  fg(color: string, text: string): string
}

export interface PiContext {
  ui?: {
    theme?: PiTheme
    setStatus?(key: string, text: string | undefined): void
    notify?(message: string, level: 'info' | 'warning' | 'error'): void
  }
  isIdle?(): boolean
  sessionManager?: { getBranch?(): unknown[]; getEntries?(): unknown[] }
}

interface SessionEntry {
  type?: string
  customType?: string
  data?: { mode?: unknown }
}

interface InputEvent {
  source?: string
  text?: string
}

interface BeforeAgentStartEvent {
  systemPrompt?: string | string[]
  systemPromptOptions?: { sections?: Record<string, string> }
}

export interface SystemPromptResult {
  systemPrompt: string | string[]
}

interface PiCommand {
  description: string
  getArgumentCompletions?(prefix: string): { value: string; label: string }[] | null
  handler(args: string, ctx: PiContext): void | Promise<void>
}

type SessionEventName = 'session_tree' | 'session_switch' | 'session_branch'

export interface PiApi {
  on(event: 'input', handler: (event: InputEvent | undefined, ctx: PiContext) => void): void
  on(
    event: 'before_agent_start',
    handler: (event: BeforeAgentStartEvent | undefined) => SystemPromptResult | undefined,
  ): void
  on(
    event: 'session_start' | 'agent_start' | 'agent_end' | SessionEventName,
    handler: (event: unknown, ctx: PiContext) => void,
  ): void
  registerCommand(name: string, command: PiCommand): void
  appendEntry(customType: string, data: { mode: string }): void
  sendUserMessage(
    text: string,
    options: { expandPromptTemplates: boolean; deliverAs?: 'followUp' },
  ): void
}

type PonytailCommand =
  | { type: 'status' }
  | { type: 'set-mode'; mode: string }
  | { type: 'set-default'; mode: string }
  | { type: 'invalid'; reason: 'invalid-default-mode' }
  | { type: 'invalid'; reason: 'invalid-mode'; mode: string | undefined }

const LEVEL_ICONS: Record<string, string> = { lite: '🌿', full: '⚡', ultra: '🔥' }
const SESSION_EVENTS: readonly SessionEventName[] = [
  'session_tree',
  'session_switch',
  'session_branch',
]
const SKILL_ALIASES = [
  'ponytail-review',
  'ponytail-audit',
  'ponytail-gain',
  'ponytail-debt',
  'ponytail-help',
] as const
const WHITESPACE_RE = /\s+/

const RUNTIME_MODE_LIST = RUNTIME_MODES.join('|')
const PONYTAIL_COMMAND_DESCRIPTION = `Set mode: ${RUNTIME_MODE_LIST}. Commands: status, default <mode>`

// Every item is a complete command: pi submits on Enter, so a bare "default" would run without a mode.
// Values only: per-level descriptions would be a second copy of the Levels table in SKILL.md.
export function completePonytailArgs(prefix: string | undefined) {
  const typed = String(prefix || '').trimStart()
  const values = [...RUNTIME_MODES, 'status', ...RUNTIME_MODES.map((m) => `default ${m}`)].filter(
    (v) => v.startsWith(typed),
  )
  return values.length ? values.map((value) => ({ value, label: value })) : null
}

export function resolveSessionMode(entries: unknown, fallbackMode: unknown = DEFAULT_MODE): string {
  const fallback = normalizeMode(fallbackMode) || DEFAULT_MODE
  if (!Array.isArray(entries)) {
    return fallback
  }

  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry: SessionEntry | undefined = entries[i]
    if (entry?.type !== 'custom' || entry?.customType !== 'ponytail-mode') {
      continue
    }

    const mode = normalizeMode(entry?.data?.mode)
    if (mode) {
      return mode
    }
  }

  return fallback
}

export function parsePonytailCommand(
  text: unknown,
  defaultMode: unknown = DEFAULT_MODE,
  currentMode: string | null = null,
): PonytailCommand {
  const fallback = normalizeMode(defaultMode) || DEFAULT_MODE
  const normalizedText = String(text || '')
    .trim()
    .toLowerCase()

  if (!normalizedText) {
    // Bare /ponytail switches ponytail on, or reports the level when it already is (#639).
    if (currentMode && currentMode !== 'off') {
      return { type: 'status' }
    }
    return { type: 'set-mode', mode: fallback === 'off' ? 'full' : fallback }
  }

  const [primary, secondary] = normalizedText.split(WHITESPACE_RE)

  if (primary === 'status') {
    return { type: 'status' }
  }

  if (primary === 'default') {
    // ponytail: a default must be a runtime level; review is session-only (#377).
    const mode = normalizeMode(secondary)
    return mode
      ? { type: 'set-default', mode }
      : { type: 'invalid', reason: 'invalid-default-mode' }
  }

  const mode = normalizeMode(primary)
  return mode
    ? { type: 'set-mode', mode }
    : { type: 'invalid', reason: 'invalid-mode', mode: primary }
}

export { writeDefaultMode }

// Returns the prompt override for a Pi/OMP hook result, or mutates Pi's
// structured sections in place and returns nothing.
function withInstructions(
  event: BeforeAgentStartEvent | undefined,
  mode: string,
): SystemPromptResult | undefined {
  if (!mode || mode === 'off') {
    // Clear a stale section when the mode is off so a previous turn does not linger (#953).
    if (event?.systemPromptOptions?.sections) {
      Reflect.deleteProperty(event.systemPromptOptions.sections, 'ponytail')
    }
    return
  }
  const instructions = getPonytailInstructions(mode)
  // Prefer structured sections so Pi can keep the cached prefix when other
  // extensions change their own section (#953). Fall back to replacement
  // for older Pi versions without systemPromptOptions.sections.
  const sections = event?.systemPromptOptions?.sections
  if (sections && typeof sections === 'object') {
    sections.ponytail = instructions
    return
  }
  // OMP passes the system prompt as an array of parts; keep it one (#776).
  if (Array.isArray(event?.systemPrompt)) {
    return { systemPrompt: [...event.systemPrompt, instructions] }
  }
  // Guard a null/undefined event or a missing systemPrompt: don't crash, and
  // don't prepend the literal string "undefined" to the prompt (#439, #440).
  const base = event?.systemPrompt ? `${event.systemPrompt}\n\n` : ''
  return { systemPrompt: `${base}${instructions}` }
}

function sendAlias(pi: PiApi, skillName: string, args: string, ctx: PiContext) {
  const normalized = String(args || '').trim()
  const message = normalized ? `${skillName} ${normalized}` : skillName

  // pi.sendUserMessage does not expand skill commands on its own, so without
  // expandPromptTemplates the alias lands as the literal text
  // "/skill:ponytail-review" and the skill body never reaches the agent.
  if (ctx.isIdle?.() === false) {
    pi.sendUserMessage(message, { expandPromptTemplates: true, deliverAs: 'followUp' })
    ctx.ui?.notify?.(`${skillName} queued as follow-up.`, 'info')
    return
  }

  pi.sendUserMessage(message, { expandPromptTemplates: true })
}

export default function ponytailExtension(pi: PiApi) {
  let currentMode = DEFAULT_MODE
  let configuredDefaultMode = getDefaultMode()
  let hideStatus = getHideStatus()
  let isActive = false
  let lastCtx: PiContext | null = null

  // -- Status bar --
  function syncStatus(ctx?: PiContext) {
    if (ctx) {
      lastCtx = ctx
    }
    const c = ctx || lastCtx
    // ponytail: hide the indicator but keep the ruleset active (#324).
    if (hideStatus) {
      return
    }
    if (!c?.ui?.setStatus) {
      return
    }
    // ponytail: try/catch guards against pi-web theme proxy throwing before initTheme
    let theme: PiTheme | undefined
    try {
      theme = c.ui.theme
      if (!theme?.fg) {
        return
      }
    } catch {
      return
    }
    if (currentMode === 'off') {
      c.ui.setStatus('ponytail', undefined)
      return
    }
    const icon = LEVEL_ICONS[currentMode] ?? ''
    const label = currentMode.toUpperCase()
    const indicator = isActive ? theme.fg('accent', '●') : theme.fg('dim', '○')
    c.ui.setStatus(
      'ponytail',
      `${indicator} 🐴 ${theme.fg('muted', 'ponytail: ')}${theme.fg('text', `${icon} ${label}`)}`,
    )
  }

  const setMode = (mode: unknown, ctx: PiContext) => {
    const normalized = normalizeMode(mode)
    if (!normalized) {
      return
    }

    currentMode = normalized
    pi.appendEntry('ponytail-mode', { mode: normalized })
    syncStatus(ctx)
    ctx.ui?.notify?.(`Ponytail mode set to ${normalized}.`, 'info')
  }

  pi.registerCommand('ponytail', {
    description: PONYTAIL_COMMAND_DESCRIPTION,
    getArgumentCompletions: (prefix: string) => completePonytailArgs(prefix),
    handler: (args: string, ctx: PiContext) => {
      const parsed = parsePonytailCommand(args, configuredDefaultMode, currentMode)

      if (parsed.type === 'status') {
        ctx.ui?.notify?.(
          `Ponytail: current ${currentMode} • default ${configuredDefaultMode}`,
          'info',
        )
        return
      }

      if (parsed.type === 'set-default') {
        try {
          const written = writeDefaultMode(parsed.mode)
          if (written) {
            configuredDefaultMode = getDefaultMode()
            const message =
              configuredDefaultMode === written
                ? `Default Ponytail mode set to ${written}.`
                : `Saved default ${written}, but env override keeps default at ${configuredDefaultMode}.`
            ctx.ui?.notify?.(message, 'info')
          }
        } catch (e) {
          ctx.ui?.notify?.(
            `Failed to save default mode: ${e instanceof Error ? e.message : String(e)}`,
            'error',
          )
        }
        return
      }

      if (parsed.type === 'set-mode') {
        setMode(parsed.mode, ctx)
        return
      }

      ctx.ui?.notify?.('Unknown or unsupported /ponytail mode.', 'warning')
    },
  })

  for (const name of SKILL_ALIASES) {
    pi.registerCommand(name, {
      description: `Run /skill:${name}`,
      handler: (args: string, ctx: PiContext) => sendAlias(pi, `/skill:${name}`, args, ctx),
    })
  }

  pi.on('input', (event, ctx) => {
    if (event?.source === 'extension') {
      return
    }

    const text = String(event?.text || '')
    if (currentMode !== 'off' && isDeactivationCommand(text)) {
      setMode('off', ctx)
    }
  })

  const restoreSessionMode = (ctx?: PiContext) => {
    const entries = ctx?.sessionManager?.getBranch?.() || ctx?.sessionManager?.getEntries?.() || []
    currentMode = resolveSessionMode(entries, configuredDefaultMode)
    syncStatus(ctx)
  }

  pi.on('session_start', (_event, ctx) => {
    configuredDefaultMode = getDefaultMode()
    hideStatus = getHideStatus()
    restoreSessionMode(ctx)
    if (!getQuietStartup()) {
      ctx.ui?.notify?.(`Ponytail loaded: ${currentMode}`, 'info')
    }
  })

  // Both hosts emit session_tree. Pi re-emits session_start on /new, /resume and
  // /fork; OMP emits session_switch and session_branch instead.
  for (const eventName of SESSION_EVENTS) {
    pi.on(eventName, (_event, ctx) => {
      restoreSessionMode(ctx)
    })
  }

  pi.on('agent_start', (_event, ctx) => {
    isActive = true
    syncStatus(ctx)
  })

  pi.on('agent_end', (_event, ctx) => {
    isActive = false
    syncStatus(ctx)
  })

  pi.on('before_agent_start', (event) => withInstructions(event, currentMode))
}
