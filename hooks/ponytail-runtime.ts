import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getClaudeDir, getQoderDir } from './ponytail-config.ts'
import {
  getClaudePluginRoot,
  getClaudeProjectDir,
  getCodeBuddyConfigDir,
  getCodeBuddyPluginRoot,
  getCopilotPluginData,
  getCursorProjectDir,
  getCursorVersion,
  getPluginData,
  getQoderSessionId,
} from './ponytail-env.ts'

const PATH_SEPARATORS_RE = /[\\/]+/
const STATE_FILE = '.ponytail-active'

// How long a hook waits for stdin before it proceeds with whatever arrived.
const STDIN_FALLBACK_MS = 1000

interface HookSpecificOutput {
  hookEventName: string
  additionalContext: string
}

// ponytail: VS Code Copilot never sets COPILOT_PLUGIN_DATA — it only injects
// CLAUDE_PLUGIN_ROOT, pointed at an install path under .vscode/agent-plugins/
// (#528). Without this fallback isCopilot was false, so ponytail assumed
// native Claude Code.
function isVsCodeCopilotRoot(pluginRoot: string | undefined): boolean {
  if (!pluginRoot) {
    return false
  }
  return (
    pluginRoot.split(PATH_SEPARATORS_RE).includes('agent-plugins') &&
    pluginRoot.toLowerCase().includes('.vscode')
  )
}

const isCopilot = Boolean(getCopilotPluginData()) || isVsCodeCopilotRoot(getClaudePluginRoot())
const isCodex = !isCopilot && Boolean(getPluginData())
const isQoder = !(isCopilot || isCodex) && Boolean(getQoderSessionId())
// CodeBuddy (#854) loads the Claude-format plugin and sets CLAUDE_PLUGIN_ROOT
// too, but adds CODEBUDDY_PLUGIN_ROOT only for its own plugin hook processes.
const isCodeBuddy = !(isCopilot || isCodex || isQoder) && Boolean(getCodeBuddyPluginRoot())
// Cursor (#817): CURSOR_VERSION is set only in the environment Cursor builds
// for hook processes (Cursor 3.20.17 assigns it in exactly one place, the hook
// env builder), so it never leaks into a Claude Code session running inside
// Cursor's terminal. Cursor also sets it when it runs a Claude-format plugin's
// hooks next to CLAUDE_PLUGIN_ROOT, and it needs Cursor-shaped JSON either
// way, so this check comes after the hosts with their own data dirs.
const isCursor = !(isCopilot || isCodex || isQoder || isCodeBuddy) && Boolean(getCursorVersion())

let stateDir = getClaudeDir()
if (isCodex) {
  stateDir = getPluginData() ?? stateDir
}
// COPILOT_PLUGIN_DATA is unset under VS Code Copilot, so fall back to
// getClaudeDir() rather than building a path from undefined.
if (isCopilot) {
  stateDir = getCopilotPluginData() || getClaudeDir()
}
if (isQoder) {
  stateDir = getQoderDir()
}
if (isCodeBuddy) {
  stateDir = getCodeBuddyConfigDir() || path.join(os.homedir(), '.codebuddy')
}
if (isCursor) {
  stateDir = path.join(os.homedir(), '.cursor')
}

const statePath = path.join(stateDir, STATE_FILE)

// Claude Code hands every hook its project dir, so the live mode is kept per
// project and concurrent sessions in different repos stop overwriting each other
// (#662, #809). Hosts without it keep the single shared flag.
// ponytail: sessions in the SAME repo still share one mode (last write wins);
// key by session_id if that matters.
const projectDir = getClaudeProjectDir()
// Replacing separators with '_' aliases e.g. /work/a/b and /work/a_b (#662).
// Do not read old sanitized keys: they cannot be assigned to one project safely.
const projectStatePath = projectDir
  ? path.join(
      stateDir,
      'ponytail-modes',
      createHash('sha256').update(path.normalize(projectDir)).digest('hex'),
    )
  : null

// The shared flag is still written, for project-less hosts.
function setMode(mode: string): void {
  for (const file of [projectStatePath, statePath]) {
    if (!file) {
      continue
    }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, mode)
  }
}

function clearMode(): void {
  for (const file of [projectStatePath, statePath]) {
    if (file) {
      try {
        fs.unlinkSync(file)
      } catch {
        // Already gone: the flag being absent is the goal
      }
    }
  }
}

// Live mode written by activate/mode-tracker. Absent flag = ponytail off.
function readMode(): string | null {
  try {
    return fs.readFileSync(projectStatePath || statePath, 'utf8').trim() || null
  } catch {
    return null
  }
}

// Cursor's always-on project rule (.cursor/rules/ponytail.mdc) already puts the
// ruleset in front of every prompt and no hook can switch a rule off, so while
// it is in the workspace the hooks step back instead of injecting a second,
// possibly contradicting, copy (#817). Cursor hands every hook the workspace
// root as CURSOR_PROJECT_DIR; project hooks also run from that directory.
// ponytail: first workspace root only, a rule in a secondary folder of a
// multi-root workspace goes undetected.
function cursorRulePath(): string | null {
  const root = getCursorProjectDir() || process.cwd()
  const rule = path.join(root, '.cursor', 'rules', 'ponytail.mdc')
  return fs.existsSync(rule) ? rule : null
}

function cursorRuleNotice(rule: string): string {
  return (
    'PONYTAIL: the always-on Cursor rule ' +
    rule +
    ' is active in this workspace and ' +
    'already carries the ponytail ruleset, so the ponytail hooks injected nothing further. ' +
    'Mode switching (/ponytail lite|full|ultra|off, "stop ponytail") is unavailable while ' +
    'that rule exists. When the user tries to switch or turn off ponytail, tell them to ' +
    'delete that rule so hooks.json can manage the level.'
  )
}

// Synchronous: every hook calls process.exit() right after this, and on macOS a pipe
// write is async, so a pending write died with the process (#1043).
function writeOut(text: string): void {
  fs.writeSync(1, text)
}

function writeHookOutput(event: string, _mode: string, context = ''): void {
  if (isCopilot) {
    // Copilot reads additionalContext on SessionStart; ignores output elsewhere.
    writeOut(
      JSON.stringify(event === 'SessionStart' && context ? { additionalContext: context } : {}),
    )
    return
  }
  if (isCodex) {
    // No systemMessage: Codex maps it to a yellow `warning:` entry (and de-greens the
    // completed-hook bullet), reading as an error every session (#605). The mode still
    // shows via the additionalContext "hook context:" line — active level when on,
    // "PONYTAIL MODE OFF" when off (that path passes context too).
    // ponytail: if openai/codex#16933 lands and hides additionalContext, restore a
    // non-warning mode signal here.
    const output: { hookSpecificOutput?: HookSpecificOutput } = {}
    if (context) {
      output.hookSpecificOutput = {
        hookEventName: event,
        additionalContext: context,
      }
    }
    writeOut(JSON.stringify(output))
    return
  }
  if (isQoder || isCodeBuddy) {
    // Qoder: hookSpecificOutput JSON, same shape as Codex minus systemMessage.
    // UserPromptSubmit additionalContext is injected into the Agent's conversation.
    // CodeBuddy would take raw stdout too, but also echoes it into the chat.
    const output: { hookSpecificOutput?: HookSpecificOutput } = {}
    if (context) {
      output.hookSpecificOutput = {
        hookEventName: event,
        additionalContext: context,
      }
    }
    writeOut(JSON.stringify(output))
    return
  }
  if (isCursor) {
    // Cursor parses stdout as JSON and treats empty stdout as "nothing to
    // say"; raw text would be logged as a parse error. sessionStart takes
    // additional_context into the conversation's system context;
    // beforeSubmitPrompt needs continue:true and, in Cursor 3.20.17, injects
    // additional_context into that turn (docs/cursor-hooks.md).
    if (!context) {
      return
    }
    const output: { additional_context: string; continue?: boolean } = {
      additional_context: context,
    }
    if (event === 'UserPromptSubmit') {
      output.continue = true
    }
    writeOut(JSON.stringify(output))
    return
  }
  // Native Claude: SessionStart accepts raw stdout, but SubagentStart needs the
  // hookSpecificOutput JSON form or the context is dropped.
  if (event === 'SubagentStart') {
    writeOut(
      JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } }),
    )
    return
  }
  writeOut(context)
}

export {
  clearMode,
  cursorRuleNotice,
  cursorRulePath,
  isCodeBuddy,
  isCodex,
  isCopilot,
  isCursor,
  isQoder,
  readMode,
  STDIN_FALLBACK_MS,
  setMode,
  writeHookOutput,
}
