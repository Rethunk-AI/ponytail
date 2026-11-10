// ponytail — OpenCode plugin.
//
// OpenCode loads every .ts/.js file directly inside plugins/ as a plugin, and a
// `plugins` config entry naming this directory resolves its index. This stays
// the only file here so each install path registers the plugin exactly once.
//
// Injects the ponytail ruleset into every chat's system prompt at the active
// intensity, persists /ponytail mode switches, and registers the /ponytail
// commands and skills so they work when the package is installed from npm.
// Reuses the shared instruction builder so Claude Code, Codex, pi, and OpenCode
// all read one source of truth.
//
// OpenCode loads this as a server plugin — add it to your opencode.json:
//   { "plugins": ["/path/to/ponytail/.opencode/plugins"] }
//
// One default export serves both plugin APIs: V2 reads `id` + `setup`, V1 calls
// `server()`.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getDefaultMode, normalizeMode, writeDefaultMode } from '../../hooks/ponytail-config.ts'
import { getXdgConfigHome } from '../../hooks/ponytail-env.ts'
import { getPonytailInstructions } from '../../hooks/ponytail-instructions.ts'
import { parseCommandFile, parseSkillFile } from '../lib/ponytail-frontmatter.ts'

// OpenCode has no flag-file convention of its own; keep mode beside its config.
// Shared with the V1 path, so a level set under either API is read by both.
const statePath = path.join(
  getXdgConfigHome() || path.join(os.homedir(), '.config'),
  'opencode',
  '.ponytail-active',
)

const WHITESPACE_RE = /\s+/

interface Mentioned {
  mention?: unknown
}

interface PromptInput {
  text?: string
  files?: readonly (Mentioned & object)[]
  agents?: readonly (Mentioned & object)[]
  skills?: readonly (Mentioned & object)[]
}

interface Editor<T> {
  add(item: T): void
}

interface SkillEntry {
  id: string
  name: string
  description: string | undefined
  path: string
  content: string
}

interface CommandRun {
  sessionID: string
  prompt: PromptInput
  delivery: string
}

interface CommandEntry {
  name: string
  description: string | undefined
  execute(run: CommandRun): Promise<void>
}

interface SystemPart {
  type: 'text'
  text: string
}

interface SystemEvent {
  system: SystemPart[]
}

interface PluginContext {
  skill: { transform(apply: (editor: Editor<SkillEntry>) => void): Promise<unknown> }
  command: { transform(apply: (editor: Editor<CommandEntry>) => void): Promise<unknown> }
  session: {
    prompt(input: PromptInput & { sessionID: string; delivery: string }): Promise<unknown>
    hook(name: 'context' | 'compaction', handler: (event: SystemEvent) => void): Promise<unknown>
  }
}

interface ServerInput {
  client?: {
    app?: {
      log(entry: { body: { service: string; level: string; message: string } }): unknown
    }
  }
}

interface LegacyConfig {
  command?: Record<string, { description: string | undefined; template: string }>
  skills?: { paths?: string[] }
}

interface LegacyHooks {
  config(config: LegacyConfig): void
  'experimental.chat.system.transform'(input: unknown, output: { system: string[] }): void
  'command.execute.before'(input: { command: string; arguments?: string; sessionID?: string }): void
}

interface PonytailPlugin {
  id: string
  setup(ctx: PluginContext): Promise<void>
  server(input?: ServerInput): LegacyHooks
}

interface CommandDefinition {
  name: string
  description: string | undefined
  template: string
}

function readMode(): string {
  try {
    // review is a one-shot command, never a level (#736); an old saved review falls back.
    return normalizeMode(fs.readFileSync(statePath, 'utf8')) || getDefaultMode()
  } catch {
    return getDefaultMode()
  }
}

function writeMode(mode: string): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  fs.writeFileSync(statePath, mode)
}

function switchOnMode(): string {
  const defaultMode = getDefaultMode()
  return defaultMode === 'off' ? 'full' : defaultMode
}

// `off` is persisted like any mode; the injection reads it and stays silent.
// An unrecognized level leaves the current one alone. The write lands before
// the next turn's injection, not the current one — good enough; switch to a
// synchronous store if same-turn switching ever matters.
function persistMode(args: string | undefined): void {
  const wanted = (args ?? '').trim()
  // `/ponytail default <level>` saves the default for new sessions, like the Claude hook.
  const [first, second] = wanted.toLowerCase().split(WHITESPACE_RE)
  if (first === 'default') {
    const saved = writeDefaultMode(second)
    if (saved) {
      process.stdout.write(`ponytail default ${saved}\n`)
    }
    return
  }
  // Bare /ponytail switches ponytail on, or keeps the level when it already is (#639).
  if (!wanted && readMode() !== 'off') {
    return
  }
  const mode = wanted ? normalizeMode(wanted) : switchOnMode()
  if (!mode) {
    return
  }
  writeMode(mode)
  process.stdout.write(`ponytail ${mode}\n`)
}

// V2 has no `config` hook: the domains that own these definitions own them now,
// so the command and skill files are read once here and handed to the
// transforms that register them.
function readCommands(): CommandDefinition[] {
  const dir = path.join(import.meta.dirname, '..', 'command')
  try {
    return fs
      .readdirSync(dir)
      .filter((file) => file.endsWith('.md'))
      .flatMap((file) => {
        const parsed = parseCommandFile(path.join(dir, file))
        return parsed ? [{ name: path.basename(file, '.md'), ...parsed }] : []
      })
  } catch {
    return []
  }
}

function readSkills(): SkillEntry[] {
  const dir = path.resolve(import.meta.dirname, '../../skills')
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const file = path.join(dir, entry.name, 'SKILL.md')
        const parsed = parseSkillFile(file)
        return parsed
          ? [
              {
                id: entry.name,
                name: parsed.name || entry.name,
                description: parsed.description,
                path: file,
                content: parsed.body,
              },
            ]
          : []
      })
  } catch {
    return []
  }
}

// Templates without $ARGUMENTS would drop what the user typed after the
// command (/ponytail-review feature/login), so append it instead.
function withArguments(template: string, input: string | undefined): string {
  const text = input ?? ''
  if (template.includes('$ARGUMENTS')) {
    return template.replaceAll('$ARGUMENTS', text)
  }
  return text.trim() ? `${template}\n\n${text.trim()}` : template
}

// An attachment's mention offsets index the typed text, which this replaces.
function withoutMentions<T extends Mentioned>(items: readonly T[] | undefined) {
  return items?.map(({ mention, ...item }) => item)
}

const plugin: PonytailPlugin = {
  id: 'ponytail',

  async setup(ctx) {
    const commands = readCommands()
    const skills = readSkills()

    await ctx.skill.transform((editor) => {
      for (const skill of skills) {
        editor.add(skill)
      }
    })

    await ctx.command.transform((editor) => {
      for (const command of commands) {
        editor.add({
          name: command.name,
          description: command.description,
          execute: async ({ sessionID, prompt, delivery }) => {
            if (command.name === 'ponytail') {
              persistMode(prompt.text)
            }
            await ctx.session.prompt({
              ...prompt,
              sessionID,
              text: withArguments(command.template, prompt.text),
              files: withoutMentions(prompt.files),
              agents: withoutMentions(prompt.agents),
              skills: withoutMentions(prompt.skills),
              delivery,
            })
          },
        })
      }
    })

    // Append the ruleset to the system prompt every turn. V2 hands over owned
    // system parts, so push one instead of rewriting the tail of another.
    // Summary compaction runs its own hook with the same event shape; without
    // it the compaction request misses the ruleset and the provider prompt cache.
    const addRuleset = (event: SystemEvent) => {
      const mode = readMode()
      if (mode === 'off') {
        return
      }
      event.system.push({ type: 'text', text: getPonytailInstructions(mode) })
    }
    await ctx.session.hook('context', addRuleset)
    await ctx.session.hook('compaction', addRuleset)
  },

  // OpenCode V1: same three behaviors, as hooks on the V1 hook names.
  server({ client } = {}) {
    const log = (level: string, message: string) => {
      try {
        client?.app?.log({ body: { service: 'ponytail', level, message } })
      } catch {
        // Logging is best-effort; a missing client must not break the hook.
      }
    }

    return {
      // Register slash commands + skills directory.
      config: (config) => {
        if (!config.command) {
          config.command = {}
        }
        for (const command of readCommands()) {
          config.command[command.name] = {
            description: command.description,
            template: command.template,
          }
        }

        config.skills = config.skills || {}
        config.skills.paths = config.skills.paths || []
        const ponytailSkillsDir = path.resolve(import.meta.dirname, '../../skills')
        if (!config.skills.paths.includes(ponytailSkillsDir)) {
          config.skills.paths.push(ponytailSkillsDir)
        }
      },

      'experimental.chat.system.transform': (_input, output) => {
        const mode = readMode()
        if (mode === 'off') {
          return
        }
        const instructions = getPonytailInstructions(mode)
        const last = output.system.length - 1
        if (last >= 0) {
          output.system[last] += `\n\n${instructions}`
        } else {
          output.system.push(instructions)
        }
      },

      'command.execute.before': (input) => {
        if (input.command !== 'ponytail') {
          return
        }
        persistMode(input.arguments)
        log('info', `ponytail ${readMode()}`)
      },
    }
  },
}

export default plugin
